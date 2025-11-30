module.exports = {
  start: {
    message: "Hi, thanks for calling. I'm an automated assistant here to help log your case. I'll ask a few questions, and you can answer as best you can.",
    next: "accident_date"
  },

  accident_date: {
    message: "First, can you tell me the date of the accident?",
    next: "accident_location"
  },

  accident_location: {
    message: "Where did the accident happen?",
    next: "truck_type"
  },

  truck_type: {
    message: "What type of truck was involved?",
    next: "injuries"
  },

  injuries: {
    message: "Can you describe any injuries you or others sustained?",
    next: "police_report"
  },

  police_report: {
    message: "Was a police report filed?",
    next: "contact"
  },

  contact: {
    message: "Can I get your full name and best phone number to reach you?",
    next: "wrap_up"
  },

  wrap_up: {
    message: "Thanks! We've logged your case. A member of our legal team will call you tomorrow during our normal working hours.",
    next: null
  }
};