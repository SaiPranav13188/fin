"""The privacy policy, served by the API so the Play Store listing and the app share one URL."""

PRIVACY_HTML = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Fin: Privacy Policy</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:0 auto;padding:32px 20px;line-height:1.6;color:#2A1B3D;background:#FFF7FB}
h1{font-size:28px}h2{font-size:18px;margin-top:28px}li{margin:6px 0}small{color:#6E5F85}</style></head><body>
<h1>Fin: Privacy Policy</h1><small>Last updated: 16 November 2026</small>
<p>Fin is an app for splitting and tracking shared bills. This page explains what Fin collects and why.</p>
<h2>What Fin does not do</h2>
<ul><li>Fin does not hold, move or process money. Payments happen in your own UPI app.</li>
<li>Fin never asks for your UPI PIN, bank login or card number.</li>
<li>Fin does not read your SMS, contacts or location.</li>
<li>Fin does not sell your data or show ads.</li></ul>
<h2>What Fin collects</h2>
<ul><li><b>Account:</b> your name, email address and, if you add them, your phone number and UPI ID. Your password is stored only as a salted hash.</li>
<li><b>What you add:</b> groups, the names and UPI IDs of friends you add, expenses, settlements, chat messages, bills and subscriptions.</li>
<li><b>Receipt photos:</b> a photo you choose is sent to our server to be read once and is not stored.</li>
<li><b>Voice:</b> speech is turned into text on your phone by your phone's speech service. Fin's servers receive only the text.</li>
<li><b>Assistant requests:</b> text you send to the assistant, and the draft it produced, are logged so we can check accuracy and prevent abuse.</li>
<li><b>Push token:</b> if you allow notifications, a device token so we can send reminders.</li></ul>
<h2>Crash reports</h2>
<p>If the app or server crashes, a technical error report is sent to our crash-reporting service (Sentry). It includes
the error, your phone model and app version. It does not include your name, email, passwords, messages or amounts.</p>
<h2>Statements you import</h2>
<p>If you import a payment statement, a CSV file is read on our server by simple rules, with no AI. A PDF or screenshot is sent to
our AI provider (Google Gemini) to be read. We do not keep the file, only the payments you choose to add. Because Fin uses
Google's free AI plan, Google may use that content to improve its products, so import PDFs or screenshots only if you are
comfortable with that. CSV import never leaves our server.</p>
<h2>AI processing</h2>
<p>To draft expenses, read receipts and answer questions, the text or photo you submit is sent to our AI provider
(Google, through the Gemini API) for processing. Fin uses it only to produce your result, never for advertising. Google may use
content sent through its free API tier to improve its own products, so avoid putting sensitive personal details in
messages to the assistant or in bill photos.</p>
<h2>Who can see your data</h2>
<p>People in a group can see that group's expenses, balances and messages, and the names and UPI IDs of its members.
Nobody outside your groups can see them.</p>
<h2>Keeping and deleting data</h2>
<p>You can delete your account in the app (You &rarr; Delete my account). Your profile and login are deleted. Entries in
shared groups stay for the other members, with your name removed.</p>
<h2>Security</h2>
<p>Data is sent over HTTPS. Login tokens are kept in your phone's secure storage.</p>
<h2>Children</h2><p>Fin is meant for people aged 18 and over.</p>
<h2>Contact</h2><p>Questions or deletion requests: use the contact email shown on the Fin Play Store listing.</p>
</body></html>"""
