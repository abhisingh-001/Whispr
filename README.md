# Whispr — Real-Time Chat Application
### SPARKIIT Full-Stack Internship Project · Developed by Abhishek Singh

Whispr is a full-stack real-time messaging app (MongoDB + Express + Node +
Socket.io, vanilla JS frontend — no build step needed) built on top of the
assigned **"Real-Time Chat Application"** brief, with several original
features layered on top to make it stand out.

---

## 1. Features that match the assignment brief

- Advanced JavaScript, REST APIs, Node backend, JWT authentication
- Real-time one-to-one chat rooms (Socket.io)
- Group chat rooms
- Online / offline presence status
- Secure login system (bcrypt password hashing + JWT)

## 2. Original / unique features added on top

| Feature | What it does |
|---|---|
| 🌗 **Dark / light mode** | Full theme system, toggle in the sidebar and in Settings. |
| 🔐 **Secure Message** | Lock any message with real **AES-256-GCM** encryption. The recipient sees a garbled preview and unlocks it with **their own PIN**. Wrong PIN never gives a hint. See section 4 below — this is the flagship feature. |
| 🔥 **Self-Destruct Secure Message** | Sender can attach a 30s / 1min / 5min timer. The countdown only starts once the recipient actually unlocks the message. |
| 📌 **Pinned messages** | Pin any message (including a still-locked Secure Message) to a bar at the top of the chat — great for group announcements. |
| 📊 **Chat Analytics** | A personal dashboard: messages sent/received, active chats, groups, and your most active day of the week. |
| 🌐 **Message Translation** | One-click "Translate" on any message, powered by the free MyMemory translation API. Supports English, Hindi, Spanish, French, German, Bengali, Tamil, Telugu, Marathi, Arabic, Chinese, Japanese. |
| 💡 **Smart Reply Suggestions** |💡 Dynamic Smart Replies: Randomized, 1-click text suggestion pills that auto-send instantly for faster communication (replaced old static buggy logic). |
| 😀 **WhatsApp-Style Emoji Keyboard** |😀 WhatsApp-Style Emoji Keyboard: Integrated a fully functional, popup emoji-picker-element right inside the chat composer for an expressive typing experience.
| ⌨️ **Typing indicator** | See when the other person is typing. |
| 🏷️ **Unique usernames** | Instagram-style handle check while typing during sign-up — live "✓ available" / "✗ already taken" feedback, enforced again on the server. Case-insensitive, 3-20 chars, letters/numbers/underscore only, always shown with an `@` prefix. |
| 🖼️ **Profile pictures** | Upload, preview, change or remove a real photo (resized/compressed client-side before upload). Falls back to the colored-initials avatar when none is set. Shown everywhere: sidebar, chat list, chat header, search results, group member lists. |
| 📝 **Message Yourself** | A permanent, WhatsApp-style personal notes chat with yourself, auto-created on first login, pinned to the top of the chat list. |
| ↩️ **Reply threads** | Right-click (or long-press on mobile) any message → Reply. Shows a quoted preview above the composer and inside the sent bubble. |
| 😀 **Message reactions** | React with ❤️ 😂 👍 😮 😢 🔥. Counts show under the bubble; click your own reaction again to remove it. |
| 🖱️ **Message context menu** | Right-click / long-press → Reply, Forward, Copy, Pin/Unpin, Make Secure, Delete. |
| 📤 **Forward & 🔐 Make Secure** | Forward any plain message to another chat; instantly convert your own plain message into a Secure Message. |
| 🗑️ **Delete for everyone** | Soft-delete your own messages — replaced with "This message was deleted" for all participants in real time. |
| 💾 **Draft messages** | Unsent text in the composer is remembered per chat and restored when you come back. |
| 🟢 **Richer presence** | Chat header shows "🟢 Online", "typing…", or "Last seen X min/hr/days ago" dynamically instead of a flat Online/Offline. |
| 👑 **Group admin controls** | Rename the group, set a group picture, add/remove members, promote/demote admins, and toggle an "announcement-only" mode where only admins can post. |
| 🔒 **Secure PIN Vault** | An optional, separately encrypted backup of your Secure Message PIN, unlockable only by re-entering your account password. See section 4. |
| 🖼️ **Original logo & branding** | Custom SVG "speech-bubble + keyhole" logo — no third-party assets. |
| 🚀 **24/7 Zero-Delay Uptime** |🚀 24/7 Zero-Delay Uptime: Integrated an automated UptimeRobot pinging mechanism (every 14 mins) to bypass Render's free-tier server sleep, ensuring the app loads instantly for every user.

Footer on every screen: **© 2026 Whispr · Developed by Abhishek Singh**

---

## 3. Project structure

```
whispr-chat/
├── server/
│   ├── server.js               # Express + Socket.io entrypoint
│   ├── config/db.js            # MongoDB connection
│   ├── models/                 # User, Chat, Message (Mongoose schemas)
│   ├── middleware/auth.js      # JWT auth guard
│   ├── utils/secureCrypto.js   # AES-256-GCM + RSA Secure Message engine
│   ├── routes/                 # auth, users, chats, messages, secure, analytics
│   └── socket/socketHandler.js # presence, typing, rooms
├── public/                     # plain HTML/CSS/JS frontend (no build step)
│   ├── index.html              # login / register
│   ├── chat.html               # main app shell + all modals
│   ├── css/style.css
│   ├── js/                     # api, auth, theme, chat, secureMessage,
│   │                           # translate, smartReply, analytics
│   └── assets/logo.svg
├── package.json
└── .env.example
```

---

## 4. How "Secure Message" actually works (important for your report)

The brief calls for AES-256-GCM and for the PIN and plaintext to never be
stored anywhere. A pure "encrypt with a key derived from the PIN" design
does not work in a real chat app because the **sender** would need the
**recipient's PIN** at send time — which defeats the purpose. Whispr solves
this with a small hybrid-encryption scheme (the same idea PGP/Signal use):

1. **PIN setup (Settings → Security):** the server generates an RSA-2048
   keypair for you. Your **public key** is stored in the clear (that's
   normal — public keys are meant to be public). Your **private key** is
   encrypted with `AES-256-GCM`, using a key derived from your PIN via
   `scrypt`. Only the encrypted private key is stored — never the PIN.
2. **Sending a Secure Message:** the server makes a random one-time AES-256
   key, encrypts your message with it, then encrypts *that* one-time key
   with the recipient's public key (RSA-OAEP). The database only ever sees
   ciphertext.
3. **Unlocking:** your PIN re-derives the wrapping key and tries to decrypt
   your private key. GCM's built-in authentication tag means a wrong PIN
   **always** fails loudly and identically — there is no partial decrypt,
   no timing hint, and the same garbled preview is shown either way.
4. **Self-destruct:** once successfully unlocked, a countdown starts in the
   browser; when it reaches zero the client tells the server to permanently
   erase the ciphertext, and every participant sees "🔥 self-destructed."

Nothing decrypted is ever written to a database, `localStorage`, or a log
file — plaintext only ever exists in the server's memory for the duration
of a single request, and in the browser's memory until the page is closed
or the self-destruct timer fires.

### 4b. The Secure PIN Vault (PIN recovery)

If you forget your Secure Message PIN there is normally no way to recover
it — that's the whole point. The **Secure PIN Vault** is an opt-in
exception: when you set/change your PIN, you can also enter your account
password. If it matches, the PIN is encrypted a second time — with a key
derived (via `scrypt`) from that account password — and stored separately
from everything else. It is never stored in plain text.

To view it later, Settings → Security → **Secure PIN Vault** asks for your
account password again, the server re-verifies it with `bcrypt`, and only
then decrypts and returns the PIN for that one response. Skip the password
step during PIN setup and the vault simply stays disabled — the PIN itself
still works fine either way, you just lose the recovery option.

### 4c. Sender can also unlock their own sent Secure Message

Normally only the recipient can ever unlock a Secure Message — that's the
whole guarantee. But it's reasonable to also want to check what you sent.
So: if the **sender** also has a PIN set up at the moment they hit send,
the server wraps the *same* one-time message key a second time with the
sender's own public key and saves that alongside the recipient's copy.
Later, either person can unlock it with their *own* PIN — the server picks
whichever wrapped key matches whoever is asking. If the sender didn't have
a PIN set up yet when they sent it, there's no sender-side copy and only
the recipient can ever open it (same as before). Either way, a wrong PIN
still looks identical, and the self-destruct countdown only ever arms from
the real recipient's unlock — the sender peeking at their own copy can't
accidentally delete a message before the recipient has seen it.

### 4d. Known simplifications (worth mentioning in your report)

Being upfront about scope, since this was built to a deadline:
- **Forward / Copy** are only available for plain-text messages, not
  locked Secure Messages — forwarding revealed secret content elsewhere
  would undermine the "only the intended people can ever read it"
  guarantee, so it's deliberately left out.
- **Group Secure Messages** need a specific recipient in the group with a
  PIN already set; there's no "lock for the whole group" mode.
- **Audio/voice messages** are not implemented — "recording…" is not a
  status the header will show, only Online / typing… / Last seen.
- **Unread counts** are tracked client-side only (reset when you open a
  chat) rather than persisted per-device on the server, which is enough
  for a single-session demo but wouldn't survive across multiple devices.
- Profile pictures and group pictures are stored as compressed base64
  strings directly on the `User`/`Chat` documents (MongoDB), which is fine
  for a project of this size but wouldn't be how you'd do it at real scale
  (you'd use object storage like S3/Cloudinary + just store a URL).

---

## 5. Setup & running it locally

### Requirements
- Node.js 18+
- A MongoDB database — either a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster, or a local `mongod`.

### Steps

```bash
# 1. Install dependencies
npm install

# 2. Configure environment variables
cp .env.example .env
# then edit .env and set:
#   MONGO_URI      -> your MongoDB connection string
#   JWT_SECRET     -> any long random string
#   SECURE_PEPPER  -> any other long random string
#   PORT           -> 5000 (or your choice)

# 3. Run it
npm start
# or, for auto-restart during development:
npm run dev

# 4. Open the app
# http://localhost:5000
```

That's it — the same server serves both the API and the frontend, so there
is nothing else to build or configure.

### Trying it out
1. Register two accounts in two different browser tabs (or incognito).
2. In **Settings**, upload a profile picture for each, and set a Secure Message PIN (optionally with your account password, to enable the PIN Vault).
3. Notice each account already has a **"Message Yourself"** chat pinned at the top.
4. Start a chat between the two accounts, right-click (or long-press) a message for **Reply / Forward / Copy / Pin / Make Secure / Delete**, and try reacting with an emoji.
5. Toggle **🔐 Secure Message**, send something, then unlock it from the other tab — try a wrong PIN a few times to see it never gives anything away.
6. Create a group, click the group name in the header to manage members, admins, and announcement-only mode.
7. Type something and switch away without sending — come back and your draft is still there.

---

## 6. Notes for the internship report

This README's sections 1, 2 and 4 map directly onto the **Abstract**,
**Objectives**, and **Methodology** sections SPARKIIT asks for. Screenshots
of the login screen, the two-account Secure Message flow (locked →
unlocking → unlocked → self-destructed), the pinned-message bar, the
analytics dashboard, and a translated message would make strong **Output
Snapshots**.

---

## 7. Bug fixes in this round

- **Fixed: switching chats quickly could show the wrong conversation's
  messages.** Opening a chat fetches its messages with an `await`; if you
  clicked a second chat before the first one's fetch finished, the slower
  response could land *after* you'd already switched, overwriting the
  screen with the wrong chat's messages. Every chat-switch now carries a
  request ID, and any response that arrives after you've moved on is
  silently discarded instead of being rendered.
- **Fixed: your own sent message could fail to appear.** Sending used to
  rely entirely on the Socket.io broadcast coming back around to render
  itself — including for your own bubble. It now renders immediately from
  the server's response to your own send, with the socket broadcast used
  only for real-time delivery to the room (with a duplicate-ID check so it
  never double-renders).
- **Added: unread badges** on the chat list (WhatsApp-style), so a message
  landing in a chat you don't have open is visible at a glance, not just a
  toast notification.
- **Added: sender-side Secure Message unlock** — see section 4c above.
- **Improved: "Start a conversation"** now leads with search (with a
  visible Search button, not just live-as-you-type) and suggested people
  shown by default; "Create a group instead" moved below the results as a
  secondary action.

---

## 8. This round: filters, chat/contact deletion, profile view, safer logout

- **Fixed the duplicate ("echo") message bug for real.** The previous fix
  only guarded the *incoming socket* handler. The actual race was on the
  *sending* side too: Socket.io's broadcast can arrive back at your own
  browser before the HTTP response to your own `POST /api/messages` call
  finishes. Both paths now go through one shared `renderIfNew()` check, so
  whichever arrives first renders it and the second one is always a no-op
  — not a coin flip.
- **Sidebar filter tabs**: All / Unread / Groups / 🔒 Secure, above the
  search box. "Secure" is backed by a real server-side check (has this
  chat ever contained a Secure Message), not just a client guess.
- **Delete a chat** (🗑 on hover in the list, WhatsApp-style): removes it
  from *your* list only — the other participant(s) still have it, and it
  automatically reappears for everyone the moment a new message is sent in
  it. "Message Yourself" can't be deleted. Deleting a message you sent was
  already supported via the right-click/long-press menu.
- **Tap a contact's photo** in the chat header to see their full profile
  (bigger picture, name, @handle, online/last-seen). Tap your own avatar
  in the sidebar to jump straight into Settings and change it.
- **Logout moved into Settings → Account**, and now asks for confirmation
  ("Log out of Whispr?") before actually signing you out — no more
  accidental one-click logouts.
- Clicking into a chat now also clears the sidebar search box, so old
  search text doesn't linger and clutter the list.
