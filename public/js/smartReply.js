(function () {
  // Simple, transparent rule-based Smart Replies - matches the pattern in
  // the brief (works fully offline, no AI API key needed).
  const RULES = [
    {
      test: /\b(coming|aa raha|aayega|available|free|join)\b.*\?|\?.*\b(coming|available)\b/i,
      replies: ['👍 Yes, I\'ll come', '❌ No, sorry', '⏰ I\'ll let you know']
    },
    {
      test: /\b(kaisa|kaise ho|how are you|how r u|how're you)\b/i,
      replies: ['😊 I\'m good, you?', '😴 Bit tired today', 'All good here!']
    },
    {
      test: /\b(kab|when|what time|kitne baje)\b/i,
      replies: ['🕐 In a bit', '📅 Tomorrow', 'Not sure yet']
    },
    {
      test: /\b(thanks|thank you|thx|dhanyawad|shukriya)\b/i,
      replies: ['🙏 Anytime!', '😊 No problem', '❤️']
    },
    {
      test: /\b(sorry|maaf)\b/i,
      replies: ['It\'s okay 🙂', 'No worries', 'Let\'s talk about it']
    },
    {
      test: /\?\s*$/,
      replies: ['👍 Yes', '❌ No', '🤔 Let me check']
    }
  ];

  const FALLBACK = ['👍', '😂', '❤️'];

  function getSmartReplies(lastIncomingText) {
    if (!lastIncomingText || !lastIncomingText.trim()) return [];
    for (const rule of RULES) {
      if (rule.test.test(lastIncomingText)) return rule.replies;
    }
    return FALLBACK;
  }

  window.Whispr = window.Whispr || {};
  window.Whispr.getSmartReplies = getSmartReplies;
})();
