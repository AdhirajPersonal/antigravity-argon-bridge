/**
 * Terminal UI Formatter with ANSI colors and markdown styling.
 * Formats long responses, thinking boxes, code snippets, and telemetry cards cleanly.
 */

export const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',

  // Foreground colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',

  // Bright colors
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',

  // Background
  bgDarkGray: '\x1b[100m',
};

export class TerminalFormatter {
  /**
   * Renders markdown with syntax color enhancements for CLI display.
   */
  static formatMarkdown(markdown: string): string {
    const lines = markdown.split('\n');
    const formatted: string[] = [];
    let inCodeBlock = false;

    for (const line of lines) {
      // Code blocks
      if (line.trim().startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        if (inCodeBlock) {
          const lang = line.trim().replace(/^```/, '').trim();
          formatted.push(`${ANSI.dim}┌─ Code (${lang || 'text'}) ─────────────────────────${ANSI.reset}`);
        } else {
          formatted.push(`${ANSI.dim}└────────────────────────────────────────────────${ANSI.reset}`);
        }
        continue;
      }

      if (inCodeBlock) {
        formatted.push(`  ${ANSI.brightGreen}${line}${ANSI.reset}`);
        continue;
      }

      // Headers
      if (line.startsWith('### ')) {
        formatted.push(`\n${ANSI.bold}${ANSI.brightYellow}${line.replace(/^### /, '◆ ')}${ANSI.reset}`);
        continue;
      }
      if (line.startsWith('## ')) {
        formatted.push(`\n${ANSI.bold}${ANSI.brightCyan}${line.replace(/^## /, '■ ')}${ANSI.reset}`);
        continue;
      }
      if (line.startsWith('# ')) {
        formatted.push(`\n${ANSI.bold}${ANSI.brightCyan}${line.replace(/^# /, '✦ ')}${ANSI.reset}`);
        continue;
      }

      // Bullet points
      let styledLine = line;
      if (styledLine.match(/^\s*[-*]\s+/)) {
        styledLine = styledLine.replace(/^(\s*)[-*]\s+/, `$1${ANSI.brightCyan}•${ANSI.reset} `);
      }

      // Bold **text**
      styledLine = styledLine.replace(/\*\*(.*?)\*\*/g, `${ANSI.bold}${ANSI.brightWhite}$1${ANSI.reset}`);

      // Inline code `code`
      styledLine = styledLine.replace(/`([^`]+)`/g, `${ANSI.yellow}$1${ANSI.reset}`);

      formatted.push(styledLine);
    }

    return formatted.join('\n');
  }

  /**
   * Renders a styled banner box.
   */
  static renderBox(title: string, content: string, borderColor: string = ANSI.cyan): string {
    const width = 64;
    const titlePadded = ` ${title} `;
    const leftPad = Math.max(2, Math.floor((width - titlePadded.length) / 2));
    const rightPad = Math.max(2, width - titlePadded.length - leftPad);

    const top = `${borderColor}╭${'─'.repeat(leftPad)}${ANSI.bold}${ANSI.brightWhite}${titlePadded}${borderColor}${'─'.repeat(rightPad)}╮${ANSI.reset}`;
    const bottom = `${borderColor}╰${'─'.repeat(width)}╯${ANSI.reset}`;

    return `${top}\n${content}\n${bottom}`;
  }

  /**
   * Renders the telemetry summary card.
   */
  static renderTelemetryCard(data: {
    tokens: { input: number; output: number; total: number };
    accountEmail: string;
    thinkingLevel: string;
    threadUrl: string;
  }): string {
    let card = `\n${ANSI.dim}────────────────────────────────────────────────────────────────${ANSI.reset}\n`;
    card += `${ANSI.bold}${ANSI.brightCyan}📊 4 Argon Consultation Telemetry${ANSI.reset}\n`;
    card += `  ${ANSI.dim}Account:${ANSI.reset}         ${ANSI.brightWhite}${data.accountEmail}${ANSI.reset}\n`;
    card += `  ${ANSI.dim}Thinking Level:${ANSI.reset}  ${ANSI.yellow}${data.thinkingLevel.toUpperCase()}${ANSI.reset}\n`;
    card += `  ${ANSI.dim}Tokens:${ANSI.reset}          ~${data.tokens.total} total (${ANSI.green}in: ${data.tokens.input}${ANSI.reset}, ${ANSI.cyan}out: ${data.tokens.output}${ANSI.reset})\n`;
    card += `  ${ANSI.dim}Thread:${ANSI.reset}          ${ANSI.underline}${ANSI.blue}${data.threadUrl}${ANSI.reset}\n`;
    card += `${ANSI.dim}────────────────────────────────────────────────────────────────${ANSI.reset}\n`;
    return card;
  }
}
