# Telegram setup for Kurt

Telegram was accepted on 2026-09-08. Intended user: `@KurtLozier`.

1. In Telegram, open the official [@BotFather](https://t.me/BotFather) and send `/newbot`.
2. Give it a display name such as **LUMINA Alerts** and an available bot username, for example `KurtLuminaAlertsBot` if available.
3. BotFather gives you a bot token. Paste it after `TELEGRAM_BOT_TOKEN=` in the existing `shared/notify.config` file. Save that file locally; do not paste the token into an agent chat or the message board. This file is excluded from Git and was created with owner-only permissions.
4. Open your new bot from your `@KurtLozier` account, press **Start**, and send `LUMINA setup for Kurt Lozier`.
5. Tell either agent “bot ready” and its bot username. Leave `TELEGRAM_CHAT_ID` and `TELEGRAM_KURT_USER_ID` blank; we will obtain them from your setup message, verify the intended private sender, and configure them without asking you to look up IDs.

We will then validate the bot token, check that an existing webhook will not conflict with polling, bind the intended private chat, finish local helper verification, and test one labeled notification from each agent. Kurt confirms receipt and replies; the agents verify the response reaches the shared decision record.

Telegram bots cannot start a private conversation before the user messages them. A personal `@username` is not a substitute for the private numeric chat ID used by this integration. [Telegram bot documentation](https://core.telegram.org/bots), [Bot API](https://core.telegram.org/bots/api#sendmessage).

WhatsApp can support automated alerts through its Business Platform. That brings business/sender onboarding and approved templates for notifications outside the 24-hour customer-service window. For a personal project coordination channel, we chose Telegram's simpler bot setup. [WhatsApp onboarding through Twilio](https://www.twilio.com/docs/whatsapp/self-sign-up), [notification templates](https://www.twilio.com/docs/whatsapp/tutorial/send-whatsapp-notification-messages-templates).
