const copyButton = document.querySelector('[data-copy]');

copyButton?.addEventListener('click', async () => {
  const command = copyButton.dataset.copy;

  if (!command) {
    return;
  }

  try {
    await navigator.clipboard.writeText(command);
    copyButton.textContent = 'Copied!';
    window.setTimeout(() => {
      copyButton.textContent = 'Copy command';
    }, 1800);
  } catch {
    copyButton.textContent = 'Select command above';
  }
});
