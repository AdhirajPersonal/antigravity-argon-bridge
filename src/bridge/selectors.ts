/**
 * UI Selectors and identifiers for gemini.google.com web interface.
 * Designed with multiple fallback strategies (text matching, role, aria-label)
 * to be resilient against UI updates.
 */

export const SELECTORS = {
  // Input and Chat Area
  chatInput: [
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
    'rich-textarea p',
    'textarea[aria-label*="prompt"]',
    'textarea',
  ],
  sendButton: [
    'button[aria-label*="Send"]',
    'button[aria-label*="submit"]',
    'button.send-button',
    'button:has(mat-icon[data-mat-icon-name="send"])',
  ],
  stopButton: [
    'button[aria-label*="Stop"]',
    'button[aria-label*="stop"]',
    'button:has(mat-icon[data-mat-icon-name="stop"])',
  ],

  // Model Selector
  modelPickerButton: [
    'button:has-text("Argon")',
    'button:has-text("Flash")',
    'button:has-text("Pro")',
    'button[aria-haspopup="menu"]',
  ],
  modelOptions: {
    argon: [
      'div[role="menuitem"]:has-text("Argon")',
      'button:has-text("Argon")',
      'span:has-text("4 Argon")',
      ':text("4 Argon")',
    ],
    flash38: [
      'div[role="menuitem"]:has-text("3.8 Flash")',
      'span:has-text("3.8 Flash")',
    ],
    pro31: [
      'div[role="menuitem"]:has-text("3.1 Pro")',
      'span:has-text("3.1 Pro")',
    ],
  },

  // Thinking Level Menu
  thinkingMenuTrigger: [
    ':text("Thinking level")',
    'div[role="menuitem"]:has-text("Thinking level")',
    'button:has-text("Thinking level")',
  ],
  thinkingLevels: {
    low: [
      ':text("Low")',
      'div[role="menuitem"]:has-text("Low")',
      'button:has-text("Low")',
    ],
    medium: [
      ':text("Medium")',
      'div[role="menuitem"]:has-text("Medium")',
      'button:has-text("Medium")',
    ],
    high: [
      ':text("High")',
      'div[role="menuitem"]:has-text("High")',
      'button:has-text("High")',
    ],
  },

  // Response Containers
  modelResponses: [
    'model-response',
    'div[data-test-id="model-response"]',
    '.model-response-text',
    '.response-container-content',
    'message-content',
  ],
  thoughtProcess: [
    '.thought-container',
    'div:has-text("Thought for")',
    'button:has-text("Thought for")',
    'details:has(summary:has-text("thought"))',
  ],

  // Usage Page (https://gemini.google.com/usage)
  usagePage: {
    container: 'body',
    title: ':text("Usage limits")',
    planBadge: ':text("PRO"), :text("ULTRA")',
    currentUsageText: ':text("% used")',
    resetsAtText: ':text("Resets at")',
    weeklyResetsText: ':text("Resets on")',
  },
};
