document.addEventListener('DOMContentLoaded', () => {
  const generatorForm = document.getElementById('generator-form');
  const filenameInput = document.getElementById('filename-base');
  const promptInput = document.getElementById('user-prompt');
  const generateBtn = document.getElementById('generate-btn');
  const btnText = generateBtn.querySelector('.btn-text');
  const btnIcon = generateBtn.querySelector('.btn-icon');
  const spinner = generateBtn.querySelector('.spinner');
  
  const codeOutput = document.getElementById('code-output');
  const filePathDisplay = document.getElementById('file-path-display');
  const editorFilename = document.getElementById('editor-filename');
  const extensionBadge = document.getElementById('extension-badge');
  const copyBtn = document.getElementById('copy-btn');
  const downloadBtn = document.getElementById('download-btn');
  const toast = document.getElementById('toast-message');

  const STORAGE_KEY = 'codeai-studio-last-generated';

  let currentCode = '';
  let currentFilename = '';
  let isGenerating = false;

  downloadBtn.title = 'Generate a file first';

  restoreLastGeneratedFile();

  // Handle form submission
  generatorForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (isGenerating) {
      return;
    }

    const customFilenameBase = filenameInput.value.trim();
    const userRequest = promptInput.value.trim();

    if (!customFilenameBase || !userRequest) {
      showToast('Please fill in both fields.', 'error');
      return;
    }

    // UI Loading state
    setLoading(true);
    isGenerating = true;

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customFilenameBase,
          userRequest
        })
      });

      const contentType = response.headers.get('content-type') || '';
      const payload = contentType.includes('application/json')
        ? await response.json()
        : await response.text();

      if (!response.ok) {
        const errorMessage = typeof payload === 'string'
          ? `Server returned ${response.status}. Verify Vercel API routing.`
          : payload.error;
        throw new Error(errorMessage || 'Failed to generate code from server.');
      }

      if (typeof payload === 'string') {
        throw new Error('Server did not return JSON. Verify API deployment configuration.');
      }

      const data = payload;

      // Render generated data
      currentCode = data.code || '';
      currentFilename = data.filename || `${customFilenameBase}${data.extension || '.txt'}`;
      
      codeOutput.textContent = currentCode;
      filePathDisplay.textContent = data.message || `Saved to ${currentFilename}`;
      editorFilename.textContent = currentFilename;
      
      extensionBadge.textContent = data.extension;
      extensionBadge.classList.remove('hidden');
      
      copyBtn.disabled = false;
      downloadBtn.disabled = false;
      downloadBtn.title = 'Download generated file';
      downloadBtn.removeAttribute('disabled');

      persistLastGeneratedFile();
      showToast('Code generated and saved successfully!', 'success');

    } catch (err) {
      console.error('Generation Error:', err);
      showToast(err.message || 'An unexpected error occurred.', 'error');
    } finally {
      isGenerating = false;
      setLoading(false);
    }
  });

  // Handle Copy Button
  copyBtn.addEventListener('click', async () => {
    if (!currentCode) return;
    try {
      await navigator.clipboard.writeText(currentCode);
      showToast('Code copied to clipboard!', 'success');
    } catch (err) {
      showToast('Failed to copy code.', 'error');
    }
  });

  // Handle Download Button
  downloadBtn.addEventListener('click', () => {
    if (!currentFilename || !currentCode) return;

    const blob = new Blob([currentCode], { type: 'text/plain;charset=utf-8' });
    const downloadUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = downloadUrl;
    anchor.download = currentFilename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(downloadUrl);
    showToast('Download started.', 'success');
  });

  // Helper functions
  function setLoading(isLoading) {
    generateBtn.disabled = isLoading;
    filenameInput.disabled = isLoading;
    promptInput.disabled = isLoading;
    generatorForm.setAttribute('aria-busy', String(isLoading));
    downloadBtn.disabled = isLoading || !currentFilename;
    downloadBtn.title = currentFilename ? 'Download generated file' : 'Generate a file first';
    if (!isLoading && currentFilename) {
      downloadBtn.removeAttribute('disabled');
    }
    if (isLoading) {
      btnText.textContent = 'Generating...';
      btnIcon.classList.add('hidden');
      spinner.classList.remove('hidden');
    } else {
      btnText.textContent = 'Generate Code';
      btnIcon.classList.remove('hidden');
      spinner.classList.add('hidden');
    }
  }

  function showToast(message, type = 'success') {
    toast.textContent = message;
    toast.className = `toast toast-${type}`;
    toast.classList.remove('hidden');

    setTimeout(() => {
      toast.classList.add('hidden');
    }, 4000);
  }

  function persistLastGeneratedFile() {
    if (!currentFilename) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      filename: currentFilename,
      code: currentCode,
    }));
  }

  function restoreLastGeneratedFile() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const saved = JSON.parse(raw);
      if (!saved?.filename) return;

      currentFilename = saved.filename;
      currentCode = saved.code || '';

      editorFilename.textContent = currentFilename;
      filePathDisplay.textContent = `Saved to ${currentFilename}`;
      extensionBadge.textContent = `.${currentFilename.split('.').pop()}`;
      extensionBadge.classList.remove('hidden');
      copyBtn.disabled = !currentCode;
      downloadBtn.disabled = false;
      downloadBtn.removeAttribute('disabled');
      downloadBtn.title = 'Download generated file';
      downloadBtn.classList.add('download-ready');
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }
});