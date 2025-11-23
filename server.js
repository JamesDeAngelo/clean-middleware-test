📞 Event: call.initiated
Full payload: {
  "data": {
    "event_type": "call.initiated",
    "id": "b97d4d5e-6fe7-4432-911f-79637bf6ebb7",
    "occurred_at": "2025-11-23T03:30:00.076316Z",
    "payload": {
      "call_control_id": "v3:2EC-70CTEjlUq3tDM0CxKXIt5-5N4iP4wo7_-PfH-qub97Sk4EqO5w",
      "call_leg_id": "b0e6224c-c81c-11f0-afbb-02420aef93a0",
      "call_session_id": "b0e6141e-c81c-11f0-abac-02420aef93a0",
      "caller_id_name": "+18124040851",
      "calling_party_type": "pstn",
      "client_state": null,
      "connection_codecs": "PCMA,PCMU,VP8,H264",
      "connection_id": "2811212257810187875",
      "direction": "incoming",
      "from": "+18124040851",
      "from_sip_uri": "8124040851@206.147.72.186:5060",
      "offered_codecs": "PCMU,G729",
      "start_time": "2025-11-23T03:30:00.076316Z",
      "state": "parked",
      "to": "+13057864498",
      "to_sip_uri": "+13057864498@192.76.120.10:5060"
    },
    "record_type": "event"
  },
  "meta": {
    "attempt": 1,
    "delivered_to": "https://clean-middleware-test-1.onrender.com/telnyx-webhook"
  }
}
✅ New call from +18124040851
🆔 Call Control ID: v3:2EC-70CTEjlUq3tDM0CxKXIt5-5N4iP4wo7_-PfH-qub97Sk4EqO5w
📞 Answering call: v3:2EC-70CTEjlUq3tDM0CxKXIt5-5N4iP4wo7_-PfH-qub97Sk4EqO5w
✅ Call answered successfully
📞 Event: call.answered
Full payload: {
  "data": {
    "event_type": "call.answered",
    "id": "6513c729-f759-47ad-b345-606732b23608",
    "occurred_at": "2025-11-23T03:30:00.996306Z",
    "payload": {
      "call_control_id": "v3:2EC-70CTEjlUq3tDM0CxKXIt5-5N4iP4wo7_-PfH-qub97Sk4EqO5w",
      "call_leg_id": "b0e6224c-c81c-11f0-afbb-02420aef93a0",
      "call_session_id": "b0e6141e-c81c-11f0-abac-02420aef93a0",
      "calling_party_type": "pstn",
      "client_state": null,
      "codec": "PCMU",
      "connection_id": "2811212257810187875",
      "from": "+18124040851",
      "sampling_rate": 8000,
      "start_time": "2025-11-23T03:30:00.076316Z",
      "to": "+13057864498"
    },
    "record_type": "event"
  },
  "meta": {
    "attempt": 1,
    "delivered_to": "https://clean-middleware-test-1.onrender.com/telnyx-webhook"
  }
}
📞 Call answered
🗣️ Speaking: "Hello! This is a test. If you can hear this, Voice API is working correctly."
✅ Speaking successfully
📞 Event: call.speak.started
Full payload: {
  "data": {
    "event_type": "call.speak.started",
    "id": "8a39ed0f-a603-41a6-9e68-c3b7293b682a",
    "occurred_at": "2025-11-23T03:30:02.456310Z",
    "payload": {
      "call_control_id": "v3:2EC-70CTEjlUq3tDM0CxKXIt5-5N4iP4wo7_-PfH-qub97Sk4EqO5w",
      "call_leg_id": "b0e6224c-c81c-11f0-afbb-02420aef93a0",
      "call_session_id": "b0e6141e-c81c-11f0-abac-02420aef93a0",
      "calling_party_type": "pstn",
      "client_state": null,
      "connection_id": "2811212257810187875",
      "speak_id": "YUw4fjNSuw"
    },
    "record_type": "event"
  },
  "meta": {
    "attempt": 1,
    "delivered_to": "https://clean-middleware-test-1.onrender.com/telnyx-webhook"
  }
}
ℹ️ Other event: call.speak.started
📞 Event: call.speak.ended
Full payload: {
  "data": {
    "event_type": "call.speak.ended",
    "id": "9a1d2ace-ad3a-4fd2-8fc1-c6114b6ec858",
    "occurred_at": "2025-11-23T03:30:07.876309Z",
    "payload": {
      "call_control_id": "v3:2EC-70CTEjlUq3tDM0CxKXIt5-5N4iP4wo7_-PfH-qub97Sk4EqO5w",
      "call_leg_id": "b0e6224c-c81c-11f0-afbb-02420aef93a0",
      "call_session_id": "b0e6141e-c81c-11f0-abac-02420aef93a0",
      "calling_party_type": "pstn",
      "client_state": null,
      "connection_id": "2811212257810187875",
      "speak_id": "YUw4fjNSuw",
      "status": "completed"
    },
    "record_type": "event"
  },
  "meta": {
    "attempt": 1,
    "delivered_to": "https://clean-middleware-test-1.onrender.com/telnyx-webhook"
  }
}
ℹ️ Other event: call.speak.ended
📞 Event: call.hangup
Full payload: {
  "data": {
    "event_type": "call.hangup",
    "id": "b7f7dc2a-dacb-4fe9-a405-653b8184400b",
    "occurred_at": "2025-11-23T03:30:30.816307Z",
    "payload": {
      "call_control_id": "v3:2EC-70CTEjlUq3tDM0CxKXIt5-5N4iP4wo7_-PfH-qub97Sk4EqO5w",
      "call_leg_id": "b0e6224c-c81c-11f0-afbb-02420aef93a0",
      "call_quality_stats": {
        "inbound": {
          "jitter_max_variance": "0.00",
          "jitter_packet_count": "0",
          "mos": "4.50",
          "packet_count": "1472",
          "skip_packet_count": "22"
        },
        "outbound": {
          "packet_count": "268",
          "skip_packet_count": "0"
        }
      },
      "call_session_id": "b0e6141e-c81c-11f0-abac-02420aef93a0",
      "calling_party_type": "pstn",
      "client_state": null,
      "connection_id": "2811212257810187875",
      "end_time": "2025-11-23T03:30:30.816307Z",
      "from": "+18124040851",
      "hangup_cause": "normal_clearing",
      "hangup_source": "caller",
      "sip_hangup_cause": "200",
      "start_time": "2025-11-23T03:30:00.076316Z",
      "to": "+13057864498"
    },
    "record_type": "event"
  },
  "meta": {
    "attempt": 1,
    "delivered_to": "https://clean-middleware-test-1.onrender.com/telnyx-webhook"
  }
}
👋 Call ended
