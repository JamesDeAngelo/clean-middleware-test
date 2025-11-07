// test_airtable.js
import Airtable from "airtable";
import dotenv from "dotenv";

dotenv.config();

// Initialize Airtable
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

async function addRecord() {
  try {
    const record = await base(process.env.AIRTABLE_TABLE_NAME).create([
      {
        fields: {
          Name: "John Doe",
          "Phone Number": "555-123-4567",
          "Date of Accident": "2025-10-10",
          "Location of Accident": "Dallas, TX",
          "Type of Truck": "18-Wheeler",
          "Injuries Sustained": "Whiplash and back pain",
          "Police Report Filed": "Yes",
        },
      },
    ]);

    console.log(`✅ Record added successfully with ID: ${record[0].id}`);
  } catch (error) {
    console.error("❌ Error adding record:", error);
  }
}

addRecord();
