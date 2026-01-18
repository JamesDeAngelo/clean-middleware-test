async function saveSessionDataBeforeCleanup(callControlId) {
  try {
    // Check if already saved to prevent duplicates
    if (sessionStore.wasSaved(callControlId)) {
      logger.info(`⏭️ Already saved - skipping duplicate save`);
      return;
    }
    
    const session = sessionStore.getSession(callControlId);
    
    if (!session) {
      logger.warn(`⚠️ No session found for ${callControlId}`);
      return;
    }
    
    // ALWAYS SAVE - even if no transcript or incomplete call
    // Minimum requirement: phone number (always available)
    const transcript = sessionStore.getFullTranscript(callControlId) || "";
    const callerPhone = session.callerPhone || "Unknown";
    
    logger.info(`💾 ALWAYS SAVING - Phone: ${callerPhone}`);
    
    if (transcript.trim().length > 0) {
      logger.info(`📋 Transcript (${transcript.length} chars):\n${transcript}`);
    } else {
      logger.info(`📋 No transcript - caller hung up immediately or didn't speak`);
    }
    
    // Extract whatever data we can from the transcript
    // If transcript is empty, this will return mostly empty fields but WILL have phone number
    const leadData = await extractLeadDataFromTranscript(transcript, callerPhone);
    
    // NEW: Add the transcript to leadData
    leadData.transcript = transcript;
    
    // NEW: Determine qualification status based on the extracted data
    // Logic: Qualified if they have all key info, Needs Review if partial, Unqualified if minimal
    let qualified = "Needs Review"; // Default
    
    const hasName = leadData.name && leadData.name.trim() !== "";
    const hasDate = leadData.dateOfAccident && leadData.dateOfAccident.trim() !== "";
    const hasLocation = leadData.accidentLocation && leadData.accidentLocation.trim() !== "";
    const hasInjuries = leadData.injuriesSustained && leadData.injuriesSustained.trim() !== "";
    const isCommercialTruck = leadData.wasCommercialTruckInvolved === "Yes";
    const sawDoctor = leadData.wereTreatedByDoctorOrHospital === "Yes";
    
    // Qualified: Has all critical info + commercial truck + medical treatment
    if (hasName && hasDate && hasLocation && hasInjuries && isCommercialTruck && sawDoctor) {
      qualified = "Qualified";
    }
    // Unqualified: Not a commercial truck OR no medical treatment OR missing critical data
    else if (leadData.wasCommercialTruckInvolved === "No" || 
             leadData.wereTreatedByDoctorOrHospital === "No" ||
             (!hasName && !hasDate && !hasLocation)) {
      qualified = "Unqualified";
    }
    // Otherwise: Needs Review (partial information or unclear answers)
    
    leadData.qualified = qualified;
    
    // ALWAYS save to Airtable - even with minimal data
    await saveLeadToAirtable(leadData);
    
    sessionStore.markAsSaved(callControlId);
    
    logger.info(`✅ SAVED TO AIRTABLE - Phone: ${callerPhone}, Name: ${leadData.name || 'Not provided'}, Qualified: ${qualified}`);
    
  } catch (error) {
    logger.error(`❌ Save failed: ${error.message}`);
    logger.error(`Stack: ${error.stack}`);
    // Even if save fails, we tried - don't crash
  }
}
