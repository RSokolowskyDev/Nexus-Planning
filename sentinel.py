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
# The stable model ID for April 2026 high-speed tasks
MODEL_ID = "gemini-2.5-flash" 
API_KEY = "AIzaSyBJFXJoe8OdSsiSD-odRvAQksZikzTukfQ"

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
            
            # Handle Text/Code
            if file.endswith(('.py', '.js', '.md', '.html', '.css', '.json')):
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        codebase_text += f"\n\n--- FILE: {file_path} ---\n{f.read()}"
                except: continue
            
            # Handle Screenshots (UX context)
            elif HAS_PILLOW and file.endswith(('.png', '.jpg', '.jpeg', '.webp')):
                try:
                    img = PIL.Image.open(file_path)
                    message_parts.append(img)
                    print(f"--- SENTINEL: Processing image context: {file} ---")
                except: continue

    # 2. THE UX PERSISTENCE PROMPT
    prompt = (
        "ACT AS: Senior Lead UX Architect. COMPARE: Codebase vs PLAN.md.\n\n"
        "GOAL: Ensure 'Mobile Day View' (overlay) PERSISTS after adding an event.\n"
        "1. Check main.js for event creation logic.\n"
        "2. Locate any code that closes the overlay or reloads the page post-creation.\n"
        "3. Instruct Claude to keep the overlay open and simply refresh its contents.\n\n"
        "OUTPUT FORMAT:\n"
        "- [PASS]: If goals met and UX is persistent.\n"
        "- [ACTION]: If changes are needed. Provide line-by-line instructions.\n"
        "- [MANUAL]: If there is a risk of a logic loop or critical error."
    )

    message_parts.insert(0, prompt)
    message_parts.append(codebase_text)

    # 3. EXECUTE & GUARD
    try:
        response = client.models.generate_content(
            model=MODEL_ID, 
            contents=message_parts
        )
        feedback = response.text
        
        # Determine Path
        if "[PASS]" in feedback.upper():
            with open("AI_FEEDBACK.md", "w", encoding='utf-8') as f:
                f.write("System Verified: UX Persistence confirmed.")
            print("--- SENTINEL: System at Equilibrium. ---")
            sys.exit(0)

        if "[MANUAL]" in feedback.upper():
            with open("AI_FEEDBACK.md", "w", encoding='utf-8') as f:
                f.write(f"# MANUAL REVIEW REQUIRED\n\n{feedback}")
            print("--- SENTINEL: Manual Intervention Triggered. ---")
            sys.exit(1) 

        # Default to ACTION (Hand-off to Claude)
        with open("AI_FEEDBACK.md", "w", encoding='utf-8') as f:
            f.write(f"# Sentinel Audit: Action Required\n\n{feedback}")

        print("--- SENTINEL: Plan updated. Claude is taking over... ---")
        sys.exit(0) 

    except Exception as e:
        # CRITICAL FIX: Stop the commit if the API fails (Quota/Network)
        print(f"\n--- SENTINEL ERROR: {str(e)} ---")
        print("--- ACTION: API unavailable. Commit aborted to prevent logic errors. ---")
        sys.exit(1) 

if __name__ == "__main__":
    run_analysis()