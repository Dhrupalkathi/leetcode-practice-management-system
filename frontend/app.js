const checkButton = document.querySelector('#check-button');
const statusLabel = document.querySelector('#status');
const resultOutput = document.querySelector('#result');

checkButton.addEventListener('click', async () => {
  checkButton.disabled = true;
  statusLabel.textContent = 'Checking…';
  statusLabel.dataset.state = 'pending';
  resultOutput.textContent = 'Contacting the backend…';

  try {
    const response = await fetch('/api/health/db', {
      method: 'GET',
      headers: { Accept: 'application/json' }
    });
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || 'Database connection failed.');
    }

    statusLabel.textContent = 'Connected';
    statusLabel.dataset.state = 'success';
    // Use textContent rather than innerHTML for API response data.
    resultOutput.textContent = payload.postgresVersion;
  } catch (error) {
    statusLabel.textContent = 'Connection failed';
    statusLabel.dataset.state = 'error';
    resultOutput.textContent = error.message;
  } finally {
    checkButton.disabled = false;
  }
});
