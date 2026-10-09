// Clipboard access that survives an insecure context.
//
// `navigator.clipboard` is only defined on HTTPS or localhost. This app is also
// served over plain http on a tailnet address — that is the phone case — where
// the API is simply absent. That is the same class of gap that made
// `crypto.randomUUID` throw: a web API the code assumed was always there. Fall
// back to a hidden textarea plus `execCommand`, which still works.
//
// Returns whether the copy actually happened, so callers can say so rather than
// claiming success.

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path below.
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
