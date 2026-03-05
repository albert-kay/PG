import os
import time
import uuid
from pathlib import Path

import anthropic
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request
from PyPDF2 import PdfReader
from docx import Document

load_dotenv()

app = Flask(__name__)
app.config["UPLOAD_FOLDER"] = Path(__file__).parent / "uploads"
app.config["UPLOAD_FOLDER"].mkdir(exist_ok=True)
app.config["MAX_CONTENT_LENGTH"] = 5 * 1024 * 1024  # 5MB

client = anthropic.Anthropic()

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt"}
CV_TTL = 3600  # 1 hour


def allowed_file(filename):
    return Path(filename).suffix.lower() in ALLOWED_EXTENSIONS


def extract_text(filepath: Path) -> str:
    suffix = filepath.suffix.lower()
    if suffix == ".pdf":
        reader = PdfReader(str(filepath))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    elif suffix == ".docx":
        doc = Document(str(filepath))
        return "\n".join(p.text for p in doc.paragraphs)
    elif suffix == ".txt":
        return filepath.read_text(encoding="utf-8")
    raise ValueError(f"Unsupported file type: {suffix}")


def call_claude(system_prompt: str, user_content: str) -> str:
    message = client.messages.create(
        model="claude-opus-4-6",
        max_tokens=4096,
        system=system_prompt,
        messages=[{"role": "user", "content": user_content}],
    )
    return message.content[0].text


# Store extracted CV text in memory with timestamps for TTL eviction
cv_store: dict[str, tuple[str, float]] = {}


def get_cv(session_id: str) -> str | None:
    entry = cv_store.get(session_id)
    if entry is None:
        return None
    text, ts = entry
    if time.time() - ts > CV_TTL:
        del cv_store[session_id]
        return None
    return text


# Action definitions: system prompt + user message prefix
ACTIONS = {
    "roast": {
        "system": (
            "You are a brutally honest HR director with 20 years of experience. "
            "Your job is to roast the candidate's CV with sharp, witty, but constructive criticism. "
            "Be specific about what's wrong. Use a mix of humor and real HR insight. "
            "Format your response with clear sections using markdown. "
            "Include: Overall Impression, Red Flags, Cringe Moments, What Made Me Yawn, "
            "and a final Verdict with a score out of 10."
        ),
        "prefix": "Roast this CV:",
    },
    "improve": {
        "system": (
            "You are a senior career coach and CV expert. "
            "Analyze the CV and provide specific, actionable improvements. "
            "Format with markdown. Include sections: "
            "1. Quick Wins (easy fixes), "
            "2. Content Improvements (what to add/remove/rewrite), "
            "3. Structure & Layout suggestions, "
            "4. Power Words to use, "
            "5. Quantifiable Achievements to highlight, "
            "6. Priority Action List (numbered, most impactful first)."
        ),
        "prefix": "Improve this CV:",
    },
    "generate": {
        "system": (
            "You are a professional CV writer. "
            "Rewrite the provided CV in an improved, polished format. "
            "Maintain the same general style and tone the user had, but make it significantly better. "
            "Keep all factual information the same. Improve wording, structure, and impact. "
            "Output the full rewritten CV in clean markdown format, ready to copy."
        ),
        "prefix": "Rewrite this CV:",
    },
    "stealth": {
        "system": (
            "You are an expert in ATS (Applicant Tracking Systems) and AI-based CV screening. "
            "Your task is to rewrite the CV with embedded optimization techniques: "
            "1. Add ATS-friendly keyword sections naturally woven into experience descriptions. "
            "2. Include invisible-to-human but machine-readable skill mentions via context clues. "
            "3. Structure content so AI parsers correctly categorize each section. "
            "4. Add strategic keyword density for common job-matching algorithms. "
            "5. Include a 'Core Competencies' or 'Key Skills' section optimized for scanning. "
            "Output the full optimized CV in markdown. At the end, add a section explaining "
            "what optimizations were made and why they help with AI screening."
        ),
        "prefix": "Optimize this CV for AI screening:",
    },
}


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/upload", methods=["POST"])
def upload_cv():
    if "cv" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["cv"]
    if not file.filename or not allowed_file(file.filename):
        return jsonify({"error": "Invalid file type. Use PDF, DOCX, or TXT"}), 400

    ext = Path(file.filename).suffix.lower()
    session_id = str(uuid.uuid4())
    filepath = app.config["UPLOAD_FOLDER"] / f"{session_id}{ext}"
    file.save(filepath)

    try:
        text = extract_text(filepath)
    except Exception:
        filepath.unlink(missing_ok=True)
        return jsonify({"error": "Could not parse the uploaded file"}), 400
    finally:
        filepath.unlink(missing_ok=True)

    if not text.strip():
        return jsonify({"error": "Could not extract text from the file"}), 400

    cv_store[session_id] = (text, time.time())
    return jsonify({"session_id": session_id, "preview": text[:500]})


@app.route("/api/<action>", methods=["POST"])
def handle_action(action):
    if action not in ACTIONS:
        return jsonify({"error": "Unknown action"}), 404

    data = request.get_json(silent=True) or {}
    session_id = data.get("session_id")
    cv_text = get_cv(session_id)
    if not cv_text:
        return jsonify({"error": "CV not found. Please upload again."}), 404

    cfg = ACTIONS[action]
    try:
        result = call_claude(cfg["system"], f"{cfg['prefix']}\n\n{cv_text}")
    except anthropic.APIError as e:
        return jsonify({"error": f"AI service error: {e.message}"}), 502
    return jsonify({"result": result})


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "").lower() == "true", port=5000)
