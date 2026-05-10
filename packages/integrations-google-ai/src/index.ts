import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  // We don't throw here to avoid breaking the build if the key is missing, 
  // but we'll log an error if someone tries to use it.
  console.warn("GEMINI_API_KEY is not set in environment variables.");
}

export const genAI = new GoogleGenerativeAI(apiKey || "");

export const geminiModel = genAI.getGenerativeModel({
  model: "gemini-3-flash-preview", // or another model
});
