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
    const response = await fetch('http://localhost:8080/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, history: chatHistory })
    });

    const data = await response.json();

    if (data.error) {
      thinkingEl.innerText = `Error: ${data.error}`;
    } else {
      thinkingEl.innerText = data.reply;
      chatHistory.push({ role: 'user', content: text });
      chatHistory.push({ role: 'assistant', content: data.reply });
    }
  } catch (err) {
    thinkingEl.innerText = 'Error connecting to server. Ensure server.js is running.';
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
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

window.sendQuickAction = sendQuickAction;
window.triggerReset = triggerReset;
window.sendMessage = sendMessage;
window.appendMessage = appendMessage;