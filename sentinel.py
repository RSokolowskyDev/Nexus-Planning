import os
import sys
import warnings
from google import genai

try:
    import PIL.Image
    HAS_PILLOW = True
except ImportError:
    HAS_PILLOW = False

warnings.filterwarnings("ignore")

# --- CONFIGURATION ---
MODEL_ID = "gemini-2.5-flash"
API_KEY = os.environ.get("GEMINI_API_KEY", "")
if not API_KEY:
    print("--- SENTINEL ERROR: GEMINI_API_KEY environment variable is not set. ---")
    print("--- Run in PowerShell: [System.Environment]::SetEnvironmentVariable('GEMINI_API_KEY', 'your-key', 'User') ---")
    sys.exit(1)

client = genai.Client(api_key=API_KEY)

# Project-specific ignore list
IGNORE = {'.git', 'node_modules', '__pycache__', 'dist', 'AI_FEEDBACK.md', 'sentinel.py', '.env', '.sentinel_lock'}

def run_analysis():
    message_parts = []
    codebase_text = "--- CODEBASE & PLAN ---\n"

    print(f"--- SENTINEL: Initializing Architect ({MODEL_ID})... ---")

    # 1. SCAN FILES
    for root, dirs, files in os.walk("."):
        dirs[:] = [d for d in dirs if d not in IGNORE]
        for file in files:
            file_path = os.path.join(root, file)

            if file.endswith(('.py', '.js', '.md', '.html', '.css', '.json')):
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        codebase_text += f"\n\n--- FILE: {file_path} ---\n{f.read()}"
                except:
                    continue

            elif HAS_PILLOW and file.endswith(('.png', '.jpg', '.jpeg', '.webp')):
                try:
                    img = PIL.Image.open(file_path)
                    message_parts.append(img)
                    print(f"--- SENTINEL: Processing image context: {file} ---")
                except:
                    continue

    # 2. ARCHITECT PROMPT
    prompt = (
        "ACT AS: Senior Lead UX Architect. COMPARE: Codebase vs PLAN.md.\n\n"
        "GOAL: Ensure 'Mobile Day View' (overlay) PERSISTS after adding an event.\n"
        "1. Check main.js for event creation logic in the FAB speed-dial handler.\n"
        "2. Locate any code that closes the overlay or reloads the page post-creation.\n"
        "3. Verify that after item creation, renderMobileDayOverlay() is called (not closeMobileDayView).\n"
        "4. Verify saveData() is called to persist the new item.\n\n"
        "OUTPUT FORMAT — use EXACTLY one of these tags on its own line:\n"
        "- [PASS]: Goals met, overlay persists, saveData() called.\n"
        "- [ACTION]: Changes needed. Provide line-by-line instructions for Claude Code.\n"
        "- [MANUAL]: Critical logic error or risk of infinite loop detected.\n"
    )

    message_parts.insert(0, prompt)
    message_parts.append(codebase_text)

    # 3. EXECUTE — hard fail on any API error (no false passes)
    try:
        response = client.models.generate_content(
            model=MODEL_ID,
            contents=message_parts
        )
        feedback = response.text

        feedback_upper = feedback.upper()

        if "[MANUAL]" in feedback_upper:
            with open("AI_FEEDBACK.md", "w", encoding='utf-8') as f:
                f.write(f"# MANUAL REVIEW REQUIRED\n\n{feedback}")
            print("--- SENTINEL: Manual Intervention Triggered. Commit blocked. ---")
            sys.exit(1)

        if "[ACTION]" in feedback_upper:
            with open("AI_FEEDBACK.md", "w", encoding='utf-8') as f:
                f.write(f"# Sentinel Audit: [ACTION] Required\n\n{feedback}")
            print("--- SENTINEL: [ACTION] detected. Handing off to Claude Code. ---")
            sys.exit(2)  # Exit code 2 = ACTION signal to the hook

        if "[PASS]" in feedback_upper:
            with open("AI_FEEDBACK.md", "w", encoding='utf-8') as f:
                f.write("# System Verified\n\nUX Persistence confirmed by Gemini Architect.")
            print("--- SENTINEL: System at Equilibrium. [PASS] ---")
            sys.exit(0)

        # No recognized tag — treat as ambiguous, block commit
        with open("AI_FEEDBACK.md", "w", encoding='utf-8') as f:
            f.write(f"# Sentinel Audit: Ambiguous Response\n\n{feedback}")
        print("--- SENTINEL: Ambiguous response from Architect. Commit blocked. ---")
        sys.exit(1)

    except Exception as e:
        print(f"\n--- SENTINEL ERROR: {str(e)} ---")
        print("--- SENTINEL: API unavailable. Commit blocked to prevent false pass. ---")
        sys.exit(1)

if __name__ == "__main__":
    run_analysis()
