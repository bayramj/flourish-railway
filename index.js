// index.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const sgMail = require('@sendgrid/mail');

const app = express();
const PORT = 3001;

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const sentOrders = new Set();

function getCustomSubject(orderId, changedFields, data) {
  if (changedFields.includes('ref_field_1')) return `🔍 QA Double Check marked Done for Order #${orderId}`;
  if (changedFields.includes('ref_field_2')) return `✏️ Modification Status marked Done for Order #${orderId}`;
  if (changedFields.includes('ref_field_3')) return `📦 Packing Status marked Done for Order #${orderId}`;
  return `📋 Order #${orderId} Update`;
}

function getOrderBody(data) {
  const lines = data.order_lines?.map((item) => {
    return `${item.order_qty}x ${item.item_name} @ $${item.unit_price} each = $${item.line_total_price}`;
  })?.join('\n') || 'No line items.';

  return `Customer: ${data.destination?.name || 'N/A'}\nStatus: ${data.order_status}\nPayment: ${data.payment_status}\nRequested Delivery: ${data.requested_delivery_date}\nQA Double Check: ${data.ref_field_1 || 'N/A'}\nModification Status: ${data.ref_field_2 || 'N/A'}\nPacking Status: ${data.ref_field_3 || 'N/A'}\n\n${lines}`;
}

function shouldSendUpdate(data, prevValues) {
  const changedFields = [];
  if (data.ref_field_1 === 'Done' && data.ref_field_1 !== prevValues.ref_field_1) changedFields.push('ref_field_1');
  if (data.ref_field_2 === 'Done' && data.ref_field_2 !== prevValues.ref_field_2) changedFields.push('ref_field_2');
  if (data.ref_field_3 === 'Done' && data.ref_field_3 !== prevValues.ref_field_3) changedFields.push('ref_field_3');
  return changedFields;
}

function getRecipientEmails(changedFields) {
  const recipients = new Set();
  if (changedFields.includes('ref_field_1')) {
    process.env.QA_ALERT_EMAILS.split(',').forEach(email => recipients.add(email.trim()));
  }
  if (changedFields.includes('ref_field_2')) {
    process.env.MOD_ALERT_EMAILS.split(',').forEach(email => recipients.add(email.trim()));
  }
  if (changedFields.includes('ref_field_3')) {
    process.env.PACKING_ALERT_EMAILS.split(',').forEach(email => recipients.add(email.trim()));
  }
  return Array.from(recipients);
}

const orderFieldCache = {}; // to store previous values for change detection

app.get('/', (req, res) => {
  res.send('✅ Webhook app is running');
});

app.post('/webhook', (req, res) => {
  const body = req.body;
  console.log('Webhook received:', body);

  if (body.resource_type !== 'order' || !body.data || !body.data.id) {
    console.log('❌ Missing or invalid order data');
    return res.status(400).send('Invalid data');
  }

  const orderId = body.data.id;
  const prev = orderFieldCache[orderId] || {};

  const changedFields = shouldSendUpdate(body.data, prev);
  if (changedFields.length === 0) {
    console.log(`⚠️ No relevant field changes for Order #${orderId}`);
    return res.status(200).send('No updates to send');
  }

  const statusKey = `${orderId}-${changedFields.map(field => body.data[field]).join('-')}`;

  if (sentOrders.has(statusKey)) {
    console.log(`🔁 Duplicate update ignored for ${statusKey}`);
    return res.status(200).send('Duplicate ignored');
  }

  sentOrders.add(statusKey);
  orderFieldCache[orderId] = {
    ref_field_1: body.data.ref_field_1,
    ref_field_2: body.data.ref_field_2,
    ref_field_3: body.data.ref_field_3,
  };

  const recipientEmails = getRecipientEmails(changedFields);

  const msg = {
    to: recipientEmails,
    from: process.env.ALERT_EMAIL,
    subject: getCustomSubject(orderId, changedFields, body.data),
    text: getOrderBody(body.data),
  };

  sgMail
    .send(msg)
    .then(() => {
      console.log(`✅ Email sent for Order #${orderId}`);
    })
    .catch((error) => {
      console.error(`❌ Email failed for Order #${orderId}`, error);
    });

  res.status(200).send('OK');
});

app.listen(PORT, () => {
  console.log(`🚀 Webhook server running on http://localhost:${PORT}`);
});
