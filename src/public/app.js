const themeDropdown = document.getElementById('theme-dropdown');
const themeNames = { light: 'Light', dark: 'Dark', hc: 'High contrast' };

function setTheme(theme) {
  if (!Object.hasOwn(themeNames, theme)) return;
  document.documentElement.dataset.theme = theme;
  themeDropdown.querySelector('.lp-dropdown__trigger-label').textContent = themeNames[theme];
}

try { setTheme(localStorage.getItem('lepide-theme') || 'light'); } catch {}
themeDropdown.addEventListener('lp-dropdown-change', (event) => {
  const theme = event.detail.option.dataset.value;
  setTheme(theme);
  try { localStorage.setItem('lepide-theme', theme); } catch {}
});

function showError(message) {
  document.getElementById('form-error-text').textContent = message;
  document.getElementById('form-error').hidden = false;
}

function fieldError(input, message = '') {
  input.setAttribute('aria-invalid', String(Boolean(message)));
  input.closest('.lp-input__field').classList.toggle('lp-input__field--error', Boolean(message));
  const error = document.getElementById(`${input.id}-error`);
  error.textContent = message;
  error.hidden = !message;
  const hint = document.getElementById(`${input.id}-hint`);
  if (hint) hint.hidden = Boolean(message);
}

function busy(button, loading) {
  button.disabled = loading;
  button.textContent = loading ? button.dataset.loading : button.dataset.idle;
  button.form.setAttribute('aria-busy', String(loading));
}

async function request(path, data) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(data)
  });
  return { response, result: await response.json() };
}

const authForm = document.querySelector('[data-auth]');
if (authForm) {
  const inputs = [...authForm.querySelectorAll('input:not([type="checkbox"])')];
  for (const input of inputs) input.addEventListener('input', () => {
    fieldError(input);
    document.getElementById('form-error').hidden = true;
  });
  authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = authForm.querySelector('[type="submit"]');
    if (button.disabled) return;
    document.getElementById('form-error').hidden = true;
    const data = Object.fromEntries(new FormData(authForm));
    data.email = data.email.trim();
    if (data.name) data.name = data.name.trim();
    data.remember = authForm.elements.namedItem('remember')?.checked === true;
    const errors = {};
    for (const input of inputs) {
      fieldError(input);
      if (!data[input.name]) errors[input.name] = `Enter your ${input.name === 'confirmPassword' ? 'password again' : input.name === 'name' ? 'full name' : input.name}.`;
    }
    if (data.email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email) || data.email.length > 254)) errors.email = 'Enter a valid email address.';
    if (data.password.length > 128) errors.password = 'Use no more than 128 characters.';
    if (authForm.dataset.auth === 'signup') {
      if (data.name.length < 2 || data.name.length > 80) errors.name = 'Enter your name using 2 to 80 characters.';
      if (data.password.length < 12) errors.password = 'Use at least 12 characters.';
      if (data.password !== data.confirmPassword) errors.confirmPassword = 'Passwords do not match.';
    }
    if (Object.keys(errors).length) {
      for (const input of inputs) if (errors[input.name]) fieldError(input, errors[input.name]);
      showError('Check the highlighted fields and try again.');
      inputs.find((input) => errors[input.name]).focus();
      return;
    }
    busy(button, true);
    try {
      const { response, result } = await request(`/api/${authForm.dataset.auth}`, data);
      if (!response.ok) {
        for (const input of inputs) if (result.fields?.[input.name]) fieldError(input, result.fields[input.name]);
        showError(result.error || 'Unable to complete your request. Try again.');
        inputs.find((input) => result.fields?.[input.name])?.focus();
        return;
      }
      location.assign('/account');
    } catch {
      showError('Cannot reach the server. Check your connection and try again.');
    } finally { busy(button, false); }
  });
}

if (document.querySelector('[data-account]')) {
  async function loadAccount() {
    try {
      const response = await fetch('/api/me', { credentials: 'same-origin' });
      if (response.status === 401) return location.replace('/login');
      if (!response.ok) throw new Error();
      const { user } = await response.json();
      document.getElementById('welcome').textContent = `Welcome, ${user.name}`;
      document.getElementById('account-name').textContent = user.name;
      document.getElementById('account-email').textContent = user.email;
      document.getElementById('account-created').textContent = new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(new Date(user.createdAt));
      document.getElementById('account-status').textContent = 'You are signed in to Lepide.';
    } catch {
      document.getElementById('account-status').textContent = 'Account unavailable.';
      showError('Cannot load your account. Refresh the page to try again.');
    }
  }
  loadAccount();
  document.getElementById('logout-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    if (button.disabled) return;
    busy(button, true);
    try {
      const { response } = await request('/api/logout', {});
      if (!response.ok) throw new Error();
      location.replace('/login');
    } catch { showError('Cannot sign out. Check your connection and try again.'); }
    finally { busy(button, false); }
  });
}