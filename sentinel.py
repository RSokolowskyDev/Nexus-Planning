import os
import re
import sys
import time
import warnings
from pathlib import Path
from google import genai

warnings.filterwarnings("ignore")

# --- CONFIGURATION ---
MODEL_ID = "gemini-3-flash-preview"
MAX_RETRIES = 3
RETRY_CAP = 120
CODEBASE_TXT = "codebase_snapshot.txt"

API_KEY = os.environ.get("GEMINI_API_KEY", "")
if not API_KEY:
    print("--- SENTINEL ERROR: GEMINI_API_KEY environment variable is not set. ---")
    print("--- Run in PowerShell: [System.Environment]::SetEnvironmentVariable('GEMINI_API_KEY', 'your-key', 'User') ---")
    sys.exit(1)

client = genai.Client(api_key=API_KEY)

IGNORE = {'.git', 'node_modules', '__pycache__', 'dist', 'AI_FEEDBACK.md',
          'sentinel.py', '.env', '.sentinel_lock', '.sentinel_iterations',
          'codebase_snapshot.txt'}

def build_codebase_txt():
    """Write entire codebase to a single .txt file for upload."""
    lines = ["NEXUS PLANNING — FULL CODEBASE SNAPSHOT\n", "=" * 60 + "\n\n"]
    for root, dirs, files in os.walk("."):
        dirs[:] = [d for d in dirs if d not in IGNORE]
        for file in sorted(files):
            file_path = os.path.join(root, file)
            if any(ign in file_path for ign in IGNORE):
                continue
            if file.endswith(('.py', '.js', '.md', '.html', '.css', '.json')):
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        content = f.read()
                    lines.append(f"\n\n{'=' * 60}\n")
                    lines.append(f"FILE: {file_path}\n")
                    lines.append(f"{'=' * 60}\n")
                    lines.append(content)
                except:
                    continue
    with open(CODEBASE_TXT, 'w', encoding='utf-8') as f:
        f.writelines(lines)
    size_kb = Path(CODEBASE_TXT).stat().st_size // 1024
    print(f"--- SENTINEL: Codebase snapshot built ({size_kb} KB) ---")

def run_analysis():
    print(f"--- SENTINEL: Initializing Architect ({MODEL_ID})... ---")

    # 1. Read PLAN.md
    try:
        with open("PLAN.md", "r", encoding="utf-8") as f:
            plan_contents = f.read().strip()
    except FileNotFoundError:
        plan_contents = "(PLAN.md not found — review code quality generally)"

    # 2. Build and upload the codebase as a .txt file
    build_codebase_txt()
    print("--- SENTINEL: Uploading codebase snapshot to Gemini Files API... ---")
    uploaded_file = client.files.upload(file=CODEBASE_TXT)
    print(f"--- SENTINEL: Upload complete ({uploaded_file.name}) ---")

    # 3. Prompt — small, references the uploaded file
    prompt = (
        "ACT AS: Senior Lead Software Architect. You are the planning brain of a two-AI pipeline.\n"
        "Your partner is Claude Code, who implements whatever instructions you provide.\n\n"
        "The attached file contains the full codebase. Review it against the current PLAN.md goals below.\n\n"
        "YOUR TASK:\n"
        "1. Check whether the PLAN.md goals are correctly implemented in the code.\n"
        "2. Look for bugs, incomplete logic, or edge cases.\n"
        "3. If all goals are met: output [PASS].\n"
        "4. If changes are needed: output [ACTION] with specific file names, function names,\n"
        "   and line-by-line instructions that Claude Code can execute directly.\n"
        "5. If there is a critical error or security issue: output [MANUAL].\n\n"
        f"CURRENT PLAN.md:\n{plan_contents}\n\n"
        "Start your response with exactly one tag on its own line:\n"
        "[PASS] / [ACTION] / [MANUAL]\n"
    )

    # 4. Call Gemini with retry on rate limits
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = client.models.generate_content(
                model=MODEL_ID,
                contents=[prompt, uploaded_file]
            )
            feedback = response.text
            feedback_upper = feedback.upper()

            # Clean up uploaded file
            try:
                client.files.delete(name=uploaded_file.name)
            except:
                pass
            os.remove(CODEBASE_TXT)

            if "[MANUAL]" in feedback_upper:
                with open("AI_FEEDBACK.md", "w", encoding='utf-8') as f:
                    f.write(f"# MANUAL REVIEW REQUIRED\n\n{feedback}")
                print("--- SENTINEL: [MANUAL] — Manual intervention required. ---")
                sys.exit(1)

            if "[ACTION]" in feedback_upper:
                with open("AI_FEEDBACK.md", "w", encoding='utf-8') as f:
                    f.write(f"# Sentinel Audit: [ACTION] Required\n\n{feedback}")
                print("--- SENTINEL: [ACTION] — Handing off to Claude Code. ---")
                sys.exit(2)

            if "[PASS]" in feedback_upper:
                with open("AI_FEEDBACK.md", "w", encoding='utf-8') as f:
                    f.write("# System Verified\n\nGemini Architect confirmed all plan goals met.")
                print("--- SENTINEL: [PASS] — Architect approved. ---")
                sys.exit(0)

            # No recognized tag
            with open("AI_FEEDBACK.md", "w", encoding='utf-8') as f:
                f.write(f"# Ambiguous Response\n\n{feedback}")
            print("--- SENTINEL: Ambiguous response. Commit blocked. ---")
            sys.exit(1)

        except Exception as e:
            err = str(e)
            retry_match = re.search(r'retry[^\d]*(\d+)', err, re.IGNORECASE)
            suggested_wait = int(retry_match.group(1)) if retry_match else 30

            if '429' in err and attempt < MAX_RETRIES:
                wait = min(suggested_wait + 5, RETRY_CAP)
                print(f"--- SENTINEL: Rate limited (attempt {attempt}/{MAX_RETRIES}). Retrying in {wait}s... ---")
                time.sleep(wait)
                continue

            print(f"\n--- SENTINEL ERROR: {err} ---")
            print("--- SENTINEL: API unavailable. Skipping review this commit. ---")
            # Clean up on error too
            try:
                client.files.delete(name=uploaded_file.name)
            except:
                pass
            if os.path.exists(CODEBASE_TXT):
                os.remove(CODEBASE_TXT)
            sys.exit(1)

if __name__ == "__main__":
    run_analysis()
