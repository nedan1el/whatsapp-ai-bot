import "dotenv/config";
import express from "express";
import OpenAI from "openai";

const app = express();
app.use(express.json());

const {
  PORT = 3000,
  VERIFY_TOKEN,
  WHATSAPP_TOKEN,
  PHONE_NUMBER_ID,
  OPENAI_API_KEY,
  ADMIN_PHONE,
  MODEL = "gpt-5.6-mini",
  SYSTEM_PROMPT = "You are a helpful WhatsApp assistant. Reply briefly and naturally in the same language as the user."
} = process.env;

const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
let botEnabled = true;
let systemPrompt = SYSTEM_PROMPT;

function normalizePhone(value = "") {
  return value.replace(/\D/g, "");
}

function isAdmin(from) {
  return normalizePhone(from) === normalizePhone(ADMIN_PHONE);
}

async function sendWhatsAppText(to, body) {
  const response = await fetch(
    `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body }
      })
    }
  );

  if (!response.ok) {
    throw new Error(`WhatsApp API error: ${response.status} ${await response.text()}`);
  }
}

async function generateReply(userText) {
  if (!openai) throw new Error("OPENAI_API_KEY is not configured.");

  const response = await openai.responses.create({
    model: MODEL,
    instructions: systemPrompt,
    input: userText
  });

  return response.output_text?.trim() || "Не удалось сформировать ответ.";
}

async function handleAdminCommand(text) {
  const [rawCommand, ...rest] = text.trim().split(/\s+/);
  const command = rawCommand.toLowerCase();
  const argument = rest.join(" ").trim();

  if (command === "/help") {
    return "Команды:\n/on — включить автоответчик\n/off — выключить автоответчик\n/status — статус\n/prompt ТЕКСТ — изменить инструкцию боту\n/reset — вернуть стандартную инструкцию";
  }
  if (command === "/on") {
    botEnabled = true;
    return "Автоответчик включён ✅";
  }
  if (command === "/off") {
    botEnabled = false;
    return "Автоответчик выключен ⏸️";
  }
  if (command === "/status") {
    return `Статус: ${botEnabled ? "включён ✅" : "выключен ⏸️"}\nМодель: ${MODEL}`;
  }
  if (command === "/prompt") {
    if (!argument) return "Использование: /prompt ТЕКСТ ИНСТРУКЦИИ";
    systemPrompt = argument;
    return "Инструкция бота обновлена ✅";
  }
  if (command === "/reset") {
    systemPrompt = SYSTEM_PROMPT;
    return "Инструкция возвращена к стандартной ✅";
  }
  return null;
}

app.get("/webhook", (req, res) => {
  if (
    req.query["hub.mode"] === "subscribe" &&
    req.query["hub.verify_token"] === VERIFY_TOKEN
  ) {
    return res.status(200).send(req.query["hub.challenge"]);
  }
  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message || message.type !== "text") return;

    const from = message.from;
    const text = message.text?.body?.trim();
    if (!text) return;

    if (isAdmin(from) && text.startsWith("/")) {
      const result = await handleAdminCommand(text);
      if (result) await sendWhatsAppText(from, result);
      return;
    }

    if (!botEnabled) return;
    await sendWhatsAppText(from, await generateReply(text));
  } catch (error) {
    console.error(error);
  }
});

app.get("/", (_req, res) => {
  res.json({ ok: true, botEnabled, webhook: "/webhook" });
});

app.listen(PORT, () => {
  console.log(`WhatsApp AI bot listening on port ${PORT}`);
});
