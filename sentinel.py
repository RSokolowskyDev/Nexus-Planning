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
    """Return files changed in the last commit."""
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

def run_analysis():
    print(f"--- SENTINEL: Initializing Architect ({MODEL_ID})... ---")

    # 1. PLAN.md — always included, defines the goal
    plan_contents = read_file_safe("PLAN.md") or "(PLAN.md not found)"

    # 2. Only the files that changed in the last commit
    all_changed = get_changed_files()
    changed_files = [
        f for f in all_changed
        if not any(ign in f for ign in IGNORE)
        and f.endswith(('.js', '.py', '.html', '.css', '.json', '.md'))
    ]

    # Skip if nothing changed, or if only PLAN.md changed (no code to review yet)
    code_files = [f for f in changed_files if not f.endswith('PLAN.md')]
    if not code_files:
        print("--- SENTINEL: Only plan/config files changed — no code to review. Skipping. ---")
        sys.exit(0)

    print(f"--- SENTINEL: Reviewing {len(code_files)} code file(s): {code_files} ---")

    # 3. Build a compact payload — PLAN.md + only changed file contents
    payload = f"PLAN.md:\n{plan_contents}\n\n{'='*60}\nCHANGED FILES:\n"
    total_chars = len(payload)

    for file_path in code_files:
        content = read_file_safe(file_path)
        if content is None:
            continue
        chunk = f"\n--- FILE: {file_path} ---\n{content}\n"
        payload += chunk
        total_chars += len(chunk)

    tokens_est = total_chars // 4
    print(f"--- SENTINEL: Payload ~{tokens_est:,} tokens ({total_chars:,} chars) ---")

    # 4. Prompt — kept minimal since payload is already focused
    prompt = (
        "ACT AS: Senior Lead Software Architect reviewing a code commit.\n"
        "Your partner Claude Code will implement any changes you specify.\n\n"
        "Review the CHANGED FILES below against the PLAN.md goals.\n"
        "Check for bugs, missing logic, or anything that doesn't satisfy the plan.\n\n"
        + payload +
        "\n\nRespond with exactly one of these on the first line, then your reasoning:\n"
        "[PASS]   — plan goals fully met, code is correct\n"
        "[ACTION] — changes needed; list exact file, function, and what to change\n"
        "[MANUAL] — critical error or security issue needing human review\n"
    )

    # 5. Call Gemini with retry on rate limits
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = client.models.generate_content(
                model=MODEL_ID,
                contents=prompt
            )
            feedback = response.text
            feedback_upper = feedback.upper()

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
            print("--- SENTINEL: Ambiguous response. Check AI_FEEDBACK.md. ---")
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
            sys.exit(1)

if __name__ == "__main__":
    run_analysis()
