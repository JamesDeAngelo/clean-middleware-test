from flask import Flask, request, jsonify
import requests
import os

app = Flask(__name__)

# Your Telnyx API Key (set this in Render environment variables)
TELNYX_API_KEY = os.environ.get('TELNYX_API_KEY')

@app.route('/webhook', methods=['POST'])
def handle_telnyx_webhook():
    try:
        data = request.json
        print(f"📞 Incoming Webhook: {data}")
        
        # Extract the Call Control ID - this is what we need to control the call
        call_control_id = data.get('CallControlId') or data.get('CallSid')
        
        # Check if this is the initial call webhook (has From/To but no CallControlId yet)
        if 'From' in data and 'To' in data and not data.get('CallControlId'):
            # This is the initial incoming call - we need to ANSWER it first
            print(f"🎯 New incoming call from {data['From']} to {data['To']}")
            
            # Get the Call Control ID from CallSid
            call_control_id = data.get('CallSid')
            
            if call_control_id:
                # Step 1: Answer the call
                answer_call(call_control_id)
                
                # Step 2: Speak something (we'll do this after answering)
                # Note: We'll actually send the speak command in response to the "answered" event
                
        # Check if this is the "call answered" event
        elif data.get('CallStatus') == 'answered' or data.get('AnsweredTime'):
            print(f"✅ Call answered, now speaking...")
            if call_control_id:
                speak_to_caller(call_control_id)
        
        return jsonify({'status': 'received'}), 200
        
    except Exception as e:
        print(f"❌ Error: {str(e)}")
        return jsonify({'error': str(e)}), 500


def answer_call(call_control_id):
    """Answer the incoming call using Telnyx Call Control API"""
    url = f"https://api.telnyx.com/v2/calls/{call_control_id}/actions/answer"
    
    headers = {
        "Authorization": f"Bearer {TELNYX_API_KEY}",
        "Content-Type": "application/json"
    }
    
    try:
        response = requests.post(url, headers=headers, json={})
        print(f"📞 Answer response: {response.status_code} - {response.text}")
        return response.json()
    except Exception as e:
        print(f"❌ Error answering call: {str(e)}")
        return None


def speak_to_caller(call_control_id):
    """Make the call speak using Telnyx Speak API"""
    url = f"https://api.telnyx.com/v2/calls/{call_control_id}/actions/speak"
    
    headers = {
        "Authorization": f"Bearer {TELNYX_API_KEY}",
        "Content-Type": "application/json"
    }
    
    payload = {
        "payload": "Hello! This is your A I assistant. If you can hear this message, your system is working correctly. How can I help you today?",
        "voice": "female",  # Options: male, female
        "language": "en-US"
    }
    
    try:
        response = requests.post(url, headers=headers, json=payload)
        print(f"🗣️ Speak response: {response.status_code} - {response.text}")
        return response.json()
    except Exception as e:
        print(f"❌ Error speaking: {str(e)}")
        return None


if __name__ == '__main__':
    # For local testing
    app.run(host='0.0.0.0', port=5000, debug=True)
