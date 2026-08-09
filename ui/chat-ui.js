const chatHistory = [];

function sendQuickAction(actionText) {
  const inputEl = document.getElementById('user-input');
  if (inputEl) {
    inputEl.value = actionText;
    sendMessage();
  }
}

function triggerReset() {
  if (typeof window.resetScene === 'function') {
    window.resetScene();
  }
  appendMessage('assistant', 'Scene and camera reset to default state.');
}

async function sendMessage() {
  const inputEl = document.getElementById('user-input');
  const sendBtn = document.getElementById('send-btn');
  const text = inputEl?.value?.trim();

  if (!text) return;

  appendMessage('user', text);
  if (inputEl) inputEl.value = '';
  if (sendBtn) sendBtn.disabled = true;

  const thinkingEl = appendMessage('assistant', 'Processing command...');

  try {
    const candidatePorts = [window.location.port, '8080', '8081', '8082', '8083', '8084']
      .filter(Boolean)
      .map(value => String(value));

    let lastError = null;
    for (const serverPort of [...new Set(candidatePorts)]) {
      try {
        const response = await fetch(`http://localhost:${serverPort}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, history: chatHistory })
        });

        const data = await response.json();

        if (data.error) {
          thinkingEl.innerText = `Error: ${data.error}`;
        } else {
          thinkingEl.innerText = data.reply;
          if (Array.isArray(data.choices) && data.choices.length > 0) {
            appendChoiceButtons(thinkingEl, data.choices);
          }
          chatHistory.push({ role: 'user', content: text });
          chatHistory.push({ role: 'assistant', content: data.reply });
        }
        return;
      } catch (err) {
        lastError = err;
      }
    }

    thinkingEl.innerText = `Error connecting to server. Ensure the server is running. ${lastError ? lastError.message : ''}`.trim();

    if (data.error) {
      thinkingEl.innerText = `Error: ${data.error}`;
    } else {
      thinkingEl.innerText = data.reply;
      if (Array.isArray(data.choices) && data.choices.length > 0) {
        appendChoiceButtons(thinkingEl, data.choices);
      }
      chatHistory.push({ role: 'user', content: text });
      chatHistory.push({ role: 'assistant', content: data.reply });
    }
  } catch (err) {
    thinkingEl.innerText = 'Error connecting to server. Ensure server.js is running.';
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
}

function appendChoiceButtons(messageEl, choices) {
  const choicesEl = document.createElement('div');
  choicesEl.className = 'choice-buttons';

  choices.forEach(({ label, message }) => {
    const button = document.createElement('button');
    button.className = 'choice-btn';
    button.type = 'button';
    button.innerText = label;
    button.addEventListener('click', () => {
      // Lock the entire choice group after one selection so the same
      // clarification cannot trigger multiple commands.
      choicesEl.querySelectorAll('.choice-btn').forEach(choice => {
        choice.disabled = true;
        choice.classList.add('choice-btn-disabled');
      });
      button.classList.add('choice-btn-selected');
      sendQuickAction(message);
    });
    choicesEl.appendChild(button);
  });

  messageEl.appendChild(choicesEl);
}

function appendMessage(role, text) {
  const messagesContainer = document.getElementById('chat-messages');
  if (!messagesContainer) return null;

  const msgDiv = document.createElement('div');
  msgDiv.className = `message ${role}`;
  msgDiv.innerText = text;
  messagesContainer.appendChild(msgDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
  return msgDiv;
}

function clearChatWindow() {
  const messagesContainer = document.getElementById('chat-messages');
  if (!messagesContainer) return;

  messagesContainer.innerHTML = '';
  messagesContainer.appendChild(Object.assign(document.createElement('div'), {
    className: 'message assistant',
    innerText: 'Chat cleared. Start a new conversation.'
  }));
}

window.sendQuickAction = sendQuickAction;
window.triggerReset = triggerReset;
window.sendMessage = sendMessage;
window.appendMessage = appendMessage;
window.clearChatWindow = clearChatWindow;
