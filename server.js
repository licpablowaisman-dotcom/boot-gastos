require('dotenv').config();
const express = require('express');
const { GoogleGenAI } = require('@google/genai');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const app = express();
app.use(express.json());

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function appendExpenseToSheets(data) {
  try {
    const serviceAccountAuth = new JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];

    await sheet.addRow({
      'Fecha': new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }),
      'Descripción': data.description,
      'Categoría': data.category,
      'Medio de Pago': data.paymentMethod,
      'Monto': data.amount,
      'Tipo': data.type === 'expense' ? 'Gasto' : 'Ingreso'
    });

    console.log('✅ Registrado en Sheets:', data.description);
  } catch (error) {
    console.error('❌ Error al guardar en Sheets:', error);
  }
}

app.get('/webhook/whatsapp', (req, res) => {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  if (req.query['hub.mode'] && req.query['hub.verify_token'] === verifyToken) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  return res.sendStatus(403);
});

app.post('/webhook/whatsapp', async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];

    if (!message || !message.text) return res.sendStatus(200);

    const userText = message.text.body;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Analiza este texto financiero en español y extrae la información: "${userText}"`,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            isFinancial: { type: "BOOLEAN" },
            amount: { type: "NUMBER" },
            description: { type: "STRING" },
            category: { type: "STRING", enum: ["Comida & Súper", "Transporte & Nafta", "Salidas & Ocio", "Servicios & Cuentas", "Salud & Farmacia", "Ingreso", "Otros"] },
            paymentMethod: { type: "STRING", enum: ["Mercado Pago", "Efectivo", "Tarjeta Crédito", "Tarjeta Débito", "Transferencia"] },
            type: { type: "STRING", enum: ["expense", "income"] }
          },
          required: ["isFinancial"]
        }
      }
    });

    const parsedData = JSON.parse(response.text);

    if (parsedData.isFinancial && parsedData.amount) {
      await appendExpenseToSheets(parsedData);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Error procesando mensaje:', err);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor en puerto ${PORT}`));
