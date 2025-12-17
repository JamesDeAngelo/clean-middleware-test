const logger = require('./utils/logger');

/**
 * Extracts structured lead data from conversation transcripts
 * This runs client-side without calling external APIs during the conversation
 */
class DataExtractor {
  constructor() {
    this.data = {
      name: '',
      phoneNumber: '',
      dateOfAccident: '',
      locationOfAccident: '',
      typeOfTruck: '',
      injuriesSustained: '',
      policeReportFiled: ''
    };
  }

  /**
   * Update data fields based on conversation context
   */
  updateFromTranscript(userMessage, contextHint = '') {
    const message = userMessage.toLowerCase();
    const originalMessage = userMessage; // Keep original case for extraction
    
    // Extract name (look for patterns like "my name is X" or "I'm X")
    if (!this.data.name) {
      const nameMatch = message.match(/(?:my name is|i'm|i am|this is|name's)\s+([a-z]+(?:\s+[a-z]+)?)/i);
      if (nameMatch) {
        this.data.name = this.toTitleCase(nameMatch[1]);
        logger.info(`📝 Extracted name: ${this.data.name}`);
      }
    }

    // Extract date patterns - MORE FLEXIBLE
    if (!this.data.dateOfAccident) {
      const dateStr = this.extractDate(message);
      if (dateStr) {
        this.data.dateOfAccident = dateStr;
        logger.info(`📅 Extracted date: ${this.data.dateOfAccident}`);
      }
    }

    // Extract location - MORE FLEXIBLE
    if (!this.data.locationOfAccident) {
      // Try multiple patterns
      let location = null;
      
      // Pattern 1: "Chicago, Illinois, Mitchell Drive" style
      const cityStateStreet = originalMessage.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),\s*([A-Z][a-z]+)(?:,\s*(.+))?/);
      if (cityStateStreet) {
        location = cityStateStreet[0].trim();
      }
      
      // Pattern 2: "on [street]" or "at [place]"
      if (!location) {
        const onAtMatch = message.match(/(?:on|at|near)\s+([a-z0-9\s,]+?)(?:\.|,|and|$)/i);
        if (onAtMatch) {
          location = onAtMatch[1].trim();
        }
      }
      
      // Pattern 3: Just any street/highway mention
      if (!location && (message.includes('drive') || message.includes('street') || message.includes('highway') || message.includes('road'))) {
        // Extract the whole phrase that seems like an address
        const addressMatch = originalMessage.match(/([A-Z][a-zA-Z\s,]+(?:Drive|Street|Highway|Road|Avenue|Boulevard)[A-Za-z\s,]*)/i);
        if (addressMatch) {
          location = addressMatch[1].trim();
        }
      }
      
      if (location) {
        this.data.locationOfAccident = location;
        logger.info(`📍 Extracted location: ${this.data.locationOfAccident}`);
      }
    }

    // Extract truck type
    if (!this.data.typeOfTruck) {
      const types = [
        { pattern: /semi[- ]?truck/i, name: 'Semi Truck' },
        { pattern: /18[- ]?wheeler/i, name: '18 Wheeler' },
        { pattern: /tractor[- ]?trailer/i, name: 'Tractor Trailer' },
        { pattern: /big rig/i, name: 'Big Rig' },
        { pattern: /delivery truck/i, name: 'Delivery Truck' },
        { pattern: /box truck/i, name: 'Box Truck' },
        { pattern: /pickup truck/i, name: 'Pickup Truck' },
        { pattern: /dump truck/i, name: 'Dump Truck' },
        { pattern: /\bsemi\b/i, name: 'Semi' }
      ];
      
      for (const type of types) {
        if (type.pattern.test(message)) {
          this.data.typeOfTruck = type.name;
          logger.info(`🚛 Extracted truck type: ${this.data.typeOfTruck}`);
          break;
        }
      }
    }

    // Extract injuries (accumulate multiple mentions)
    if (message.includes('hurt') || message.includes('pain') || message.includes('injur') || 
        message.includes('broke') || message.includes('fracture')) {
      const injuries = this.extractInjuries(message);
      if (injuries) {
        if (this.data.injuriesSustained) {
          // Don't duplicate
          if (!this.data.injuriesSustained.toLowerCase().includes(injuries.toLowerCase())) {
            this.data.injuriesSustained += '; ' + injuries;
          }
        } else {
          this.data.injuriesSustained = injuries;
        }
        logger.info(`🏥 Extracted injuries: ${injuries}`);
      }
    }

    // Extract police report status
    if (!this.data.policeReportFiled) {
      if (message.includes('yes') || message.includes('came') || message.includes('filed') || 
          message.includes('they came') || message.includes('police came')) {
        this.data.policeReportFiled = 'Yes';
      } else if (message.includes('no') || message.includes('didn\'t') || message.includes('not')) {
        this.data.policeReportFiled = 'No';
      }
      if (this.data.policeReportFiled) {
        logger.info(`👮 Extracted police report: ${this.data.policeReportFiled}`);
      }
    }
  }

  /**
   * Extract and format date from natural language
   */
  extractDate(message) {
    const today = new Date();
    
    // Check for "today"
    if (message.includes('today')) {
      return this.formatDate(today);
    }
    
    // Check for "yesterday"
    if (message.includes('yesterday')) {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      return this.formatDate(yesterday);
    }
    
    // Check for "last week"
    if (message.includes('last week')) {
      const lastWeek = new Date(today);
      lastWeek.setDate(lastWeek.getDate() - 7);
      return this.formatDate(lastWeek);
    }
    
    // Check for "last month"
    if (message.includes('last month')) {
      const lastMonth = new Date(today);
      lastMonth.setMonth(lastMonth.getMonth() - 1);
      return this.formatDate(lastMonth);
    }
    
    // Match patterns like "3 days ago", "2 months ago", "1 year ago"
    const agoMatch = message.match(/(\d+)\s+(day|week|month|year)s?\s+ago/);
    if (agoMatch) {
      const [, num, unit] = agoMatch;
      const date = new Date(today);
      const amount = parseInt(num);
      
      switch (unit) {
        case 'day':
          date.setDate(date.getDate() - amount);
          break;
        case 'week':
          date.setDate(date.getDate() - (amount * 7));
          break;
        case 'month':
          date.setMonth(date.getMonth() - amount);
          break;
        case 'year':
          date.setFullYear(date.getFullYear() - amount);
          break;
      }
      
      return this.formatDate(date);
    }
    
    // Match specific dates like "December 5" or "Dec 5, 2024"
    const dateMatch = message.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:,?\s+(\d{4}))?\b/i);
    if (dateMatch) {
      const [, month, day, year] = dateMatch;
      const monthMap = {
        'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
        'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
      };
      const date = new Date(
        year ? parseInt(year) : today.getFullYear(),
        monthMap[month.toLowerCase().slice(0, 3)],
        parseInt(day)
      );
      return this.formatDate(date);
    }
    
    // If message is just a date word without context
    if (message === 'yesterday' || message.trim() === 'yesterday') {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      return this.formatDate(yesterday);
    }
    
    return null;
  }

  /**
   * Extract injury descriptions
   */
  extractInjuries(message) {
    const injuries = [];
    const terms = [
      'back pain', 'neck pain', 'whiplash', 'broken', 'fractured', 'concussion',
      'bruised', 'laceration', 'cut', 'bleeding', 'head', 'spine', 'leg', 'arm',
      'shoulder', 'hip', 'knee', 'foot', 'hand', 'ribs'
    ];
    
    for (const term of terms) {
      if (message.includes(term)) {
        injuries.push(term);
      }
    }
    
    return injuries.length > 0 ? this.toTitleCase(injuries.join(', ')) : null;
  }

  /**
   * Format date as YYYY-MM-DD for Airtable
   */
  formatDate(date) {
    return date.toISOString().split('T')[0];
  }

  /**
   * Convert string to Title Case
   */
  toTitleCase(str) {
    return str.replace(/\w\S*/g, (txt) => {
      return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
    });
  }

  /**
   * Set phone number from caller ID
   */
  setPhoneNumber(phoneNumber) {
    this.data.phoneNumber = phoneNumber;
    logger.info(`📞 Set phone number: ${phoneNumber}`);
  }

  /**
   * Get current data state
   */
  getData() {
    return { ...this.data };
  }

  /**
   * Check if we have minimum required data
   */
  hasMinimumData() {
    return !!(this.data.phoneNumber && this.data.name);
  }
}

module.exports = DataExtractor;