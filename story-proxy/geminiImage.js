export function buildGeminiImageRequest({ model, key, prompt }) {
  return {
    url: `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent`,
    options: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_LOW_AND_ABOVE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
        ]
      })
    }
  };
}

export function extractGeminiImageResult(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((part) => {
    const inlineData = part.inlineData || part.inline_data;
    const mimeType = inlineData?.mimeType || inlineData?.mime_type;
    return mimeType?.startsWith("image/");
  });
  const inlineData = imagePart?.inlineData || imagePart?.inline_data;
  const mimeType = inlineData?.mimeType || inlineData?.mime_type;

  if (!inlineData?.data || !mimeType) {
    throw new Error(`이미지 없음: ${JSON.stringify(data).slice(0, 300)}`);
  }

  return { b64: inlineData.data, mimeType };
}
