#!/usr/bin/env python3
"""
Simple script to run Gemma 3:1b model with Ollama and stream responses.
"""

import ollama
import sys

def stream_chat(prompt, model="gemma3:1b"):
    """
    Stream a chat response from the specified model.
    
    Args:
        prompt: The user's prompt/question
        model: The model name (default: gemma3:1b)
    """
    try:
        # Create a streaming chat request
        stream = ollama.chat(
            model=model,
            messages=[
                {'role': 'user', 'content': prompt}
            ],
            stream=True,
        )
        
        # Print the streamed response chunk by chunk
        print("Response: ", end='', flush=True)
        for chunk in stream:
            if 'message' in chunk and 'content' in chunk['message']:
                content = chunk['message']['content']
                print(content, end='', flush=True)
        print()  # New line at the end
        
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    # Get prompt from command line or use default
    if len(sys.argv) > 1:
        prompt = " ".join(sys.argv[1:])
    else:
        prompt = "Explain what machine learning is in simple terms."
    
    print(f"Prompt: {prompt}\n")
    stream_chat(prompt)

