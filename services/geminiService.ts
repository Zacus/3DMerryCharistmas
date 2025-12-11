import { GoogleGenAI } from "@google/genai";

let client: GoogleGenAI | null = null;

const getClient = () => {
  if (!client && process.env.API_KEY) {
    client = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }
  return client;
};

export const generateHolidayDescription = async (imageUrl: string): Promise<string> => {
  const ai = getClient();
  if (!ai) return "Upload your API Key to see magic descriptions!";

  try {
    // Convert blob URL to base64 if necessary, or pass straight if it was base64.
    // For this demo, we assume the user uploads a file which we convert to base64 for the API.
    // Fetching the blob data from the object URL created in the app.
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    const base64Data = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const result = reader.result as string;
            // Remove data:image/xxx;base64, prefix
            const base64 = result.split(',')[1]; 
            resolve(base64);
        } 
        reader.readAsDataURL(blob);
    });

    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'image/jpeg', // Assuming jpeg/png generic
              data: base64Data
            }
          },
          {
            text: "Write a very short, poetic, 2-line Christmas wish or memory description based on this photo. Focus on the warmth and joy. Do not use markdown."
          }
        ]
      }
    });

    return result.text || "Merry Christmas!";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "A magical Christmas memory.";
  }
};
