import os
import logging
from google import genai
from utils.ai.conversation import conversations
from utils.ai.prompts import CHARACTER_PROMPT

MODEL = "models/gemini-3.6-flash"

logger = logging.getLogger(__name__)

client = genai.Client(
    api_key=os.getenv("GEMINI_API_KEY")
)


def build_prompt(history, prompt):
    full_prompt = CHARACTER_PROMPT + "\n\n"

    for role, message in history:
        full_prompt += f"{role}: {message}\n"

    full_prompt += f"user: {prompt}\nassistant:"

    return full_prompt

def generate_response(channel_id: int, prompt: str) -> str:
    history = conversations[channel_id]

    full_prompt = build_prompt(history, prompt)

    try:
        response = client.models.generate_content(
            model=MODEL,
            contents=full_prompt
        )

        history.append(("user", prompt))

        reply = response.text or "I'm not sure how to respond to that."

        history.append(("assistant", reply))

        return reply

    except Exception:
        logger.exception("Gemini request failed")
        raise