import os
import sys
import warnings
from google import genai

warnings.filterwarnings("ignore")

# Initialize with your verified 2.5 Flash Key
client = genai.Client(api_key="AIzaSyBJFXJoe8OdSsiSD-odRvAQksZikzTukfQ")
MODEL_ID = "gemini-2.5-flash"

IGNORE = {'.git', 'node_modules', '__pycache__', 'dist', 'AI_FEEDBACK.md', 'sentinel.py', '.env'}

def run_analysis():
    codebase = ""
    for root, dirs, files in os.walk("."):
        dirs[:] = [d for d in dirs if d not in IGNORE]
        for file in files:
            try:
                file_path = os.path.join(root, file)
                with open(file_path, 'r', encoding='utf-8') as f:
                    codebase += f"\n\n--- FILE: {file_path} ---\n{f.read()}"
            except: continue

    prompt = (
        "ACT AS: Senior Lead Architect. COMPARE: Codebase vs PLAN.md.\n\n"
        "1. VERIFICATION: If goals in PLAN.md are met, output ONLY [PASS].\n"
        "2. AUTONOMOUS: If work is needed, output [ACTION] + steps for Claude.\n"
        "3. MANUAL: If a secret key/manual setup is needed, output [MANUAL] + Reason.\n\n"
        "PREFERENCE: Choose [ACTION] over [MANUAL] if a mockup or placeholder works."
    )

    try:
        response = client.models.generate_content(model=MODEL_ID, contents=[prompt, codebase])
        feedback = response.text
        
        if "[PASS]" in feedback.upper():
            with open("AI_FEEDBACK.md", "w", encoding='utf-8') as f:
                f.write("System Verified: All tasks complete.")
            print("--- SENTINEL: Goal Reached. Loop Terminated. ---")
            sys.exit(0)

        if "[MANUAL]" in feedback.upper():
            print("--- SENTINEL: Manual Intervention Required. Check AI_FEEDBACK.md. ---")
            with open("AI_FEEDBACK.md", "w", encoding='utf-8') as f:
                f.write(f"# MANUAL INTERVENTION REQUIRED\n\n{feedback}")
            sys.exit(1) # Stops the commit

        with open("AI_FEEDBACK.md", "w", encoding='utf-8') as f:
            f.write(f"# Sentinel Audit: Action Required\n\n{feedback}")

        print("--- SENTINEL: Plan updated. Claude is taking over... ---")
        sys.exit(0) 

    except Exception as e:
        print(f"SENTINEL Error: {str(e)}")
        sys.exit(0)

if __name__ == "__main__":
    run_analysis()