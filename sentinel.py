import os
import re
import sys
import time
import subprocess
import warnings
from google import genai

warnings.filterwarnings("ignore")

# --- CONFIGURATION ---
MODEL_ID = "gemini-3-flash-preview"
MAX_RETRIES = 3
RETRY_CAP = 120

# Core app files Gemini reads when writing instructions (PLAN.md changed mode)
CONTEXT_FILES = ['main.js', 'index.html', 'index.css']

API_KEY = os.environ.get("GEMINI_API_KEY", "")
if not API_KEY:
    print("--- SENTINEL ERROR: GEMINI_API_KEY environment variable is not set. ---")
    print("--- Run in PowerShell: [System.Environment]::SetEnvironmentVariable('GEMINI_API_KEY', 'your-key', 'User') ---")
    sys.exit(1)

client = genai.Client(api_key=API_KEY)

IGNORE = {'.git', 'node_modules', '__pycache__', 'dist', 'AI_FEEDBACK.md',
          'sentinel.py', '.env', '.sentinel_lock', '.sentinel_iterations',
          'codebase_snapshot.txt'}

def get_changed_files():
    try:
        result = subprocess.run(
            ['git', 'diff-tree', '--no-commit-id', '-r', '--name-only', 'HEAD'],
            capture_output=True, text=True
        )
        return [f.strip() for f in result.stdout.strip().splitlines() if f.strip()]
    except Exception:
        return []

def read_file_safe(path):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return f.read()
    except Exception:
        return None

def build_payload(files):
    payload = ""
    total_chars = 0
    for file_path in files:
        content = read_file_safe(file_path)
        if content is None:
            continue
        chunk = f"\n--- FILE: {file_path} ---\n{content}\n"
        payload += chunk
        total_chars += len(chunk)
    return payload, total_chars

def call_gemini(prompt):
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = client.models.generate_content(model=MODEL_ID, contents=prompt)
            return response.text
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
            sys.exit(1)

def handle_response(feedback):
    feedback_upper = feedback.upper()

    if "[MANUAL]" in feedback_upper:
        with open("AI_FEEDBACK.md", "w", encoding='utf-8') as f:
            f.write(f"# MANUAL REVIEW REQUIRED\n\n{feedback}")
        print("--- SENTINEL: [MANUAL] — Manual intervention required. ---")
        sys.exit(1)

    if "[ACTION]" in feedback_upper:
        with open("AI_FEEDBACK.md", "w", encoding='utf-8') as f:
            f.write(f"# Sentinel: [ACTION] Required\n\n{feedback}")
        print("--- SENTINEL: [ACTION] — Handing off to Claude Code. ---")
        sys.exit(2)

    if "[PASS]" in feedback_upper:
        with open("AI_FEEDBACK.md", "w", encoding='utf-8') as f:
            f.write("# System Verified\n\nGemini Architect confirmed all plan goals met.")
        print("--- SENTINEL: [PASS] — Architect approved. ---")
        sys.exit(0)

    with open("AI_FEEDBACK.md", "w", encoding='utf-8') as f:
        f.write(f"# Ambiguous Response\n\n{feedback}")
    print("--- SENTINEL: Ambiguous response. Check AI_FEEDBACK.md. ---")
    sys.exit(1)

def run_analysis():
    print(f"--- SENTINEL: Initializing Architect ({MODEL_ID})... ---")

    plan_contents = read_file_safe("PLAN.md") or "(PLAN.md not found)"

    all_changed = get_changed_files()
    code_files = [
        f for f in all_changed
        if not any(ign in f for ign in IGNORE)
        and f.endswith(('.js', '.html', '.css', '.json'))
    ]
    plan_changed = any(f.endswith('PLAN.md') for f in all_changed)

    # --- MODE A: PLAN.md changed, no code changed ---
    # Gemini reads existing code and writes precise, structured instructions for Claude
    if plan_changed and not code_files:
        print("--- SENTINEL: PLAN.md updated — generating implementation instructions for Claude... ---")
        payload, total_chars = build_payload(CONTEXT_FILES)
        tokens_est = (len(plan_contents) + total_chars) // 4
        print(f"--- SENTINEL: Payload ~{tokens_est:,} tokens ---")

        prompt = (
            "ACT AS: Senior Lead Software Architect. Write precise implementation instructions\n"
            "for Claude Code, who will implement them and commit the result.\n\n"
            "RULES FOR YOUR RESPONSE:\n"
            "1. Start with [ACTION] on its own line.\n"
            "2. For each unchecked [ ] task in PLAN.md, write a numbered section.\n"
            "3. Each section must specify: exact FILE, exact FUNCTION or line area, and the\n"
            "   EXACT CODE to add/change — use code blocks. Be specific enough that Claude\n"
            "   can implement without guessing.\n"
            "4. Do NOT tell Claude to update PLAN.md or mark tasks complete.\n"
            "   You (Gemini) will verify completion on the next review.\n"
            "5. If all tasks are already implemented, start with [PASS] instead.\n\n"
            f"PLAN.md:\n{plan_contents}\n\n"
            f"EXISTING CODE:\n{payload}"
        )

    # --- MODE B: Code files changed ---
    # Gemini verifies the implementation matches the remaining unchecked plan tasks
    elif code_files:
        print(f"--- SENTINEL: Verifying {len(code_files)} changed file(s): {code_files} ---")
        payload, total_chars = build_payload(code_files)
        tokens_est = (len(plan_contents) + total_chars) // 4
        print(f"--- SENTINEL: Payload ~{tokens_est:,} tokens ---")

        # Only check unchecked tasks — match both '[ ]' and '[]' formats
        unchecked = [l for l in plan_contents.splitlines() if re.match(r'\s*\[\s?\]', l)]
        remaining = '\n'.join(unchecked) if unchecked else '(all tasks marked complete)'

        prompt = (
            "ACT AS: Senior Lead Software Architect verifying a code commit.\n\n"
            "Check ONLY the unchecked tasks below against the changed files.\n"
            "Ignore anything already marked [x] — do not re-review completed work.\n\n"
            f"UNCHECKED TASKS:\n{remaining}\n\n"
            f"CHANGED FILES:\n{payload}\n\n"
            "RULES FOR YOUR RESPONSE:\n"
            "1. If all unchecked tasks are correctly implemented: respond [PASS].\n"
            "2. If any unchecked task is missing or buggy: respond [ACTION] followed by\n"
            "   specific file + function + exact code fix for ONLY what is wrong.\n"
            "   Do NOT repeat instructions for things that are already correct.\n"
            "3. If critical error: respond [MANUAL].\n"
        )

    else:
        print("--- SENTINEL: No relevant changes detected. Skipping. ---")
        sys.exit(0)

    feedback = call_gemini(prompt)
    handle_response(feedback)

if __name__ == "__main__":
    run_analysis()
