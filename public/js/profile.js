(function () {
  const { api, getUser, setSession, getToken, paintAvatar } = window.Whispr;

  const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  const MAX_RAW_BYTES = 8 * 1024 * 1024; // reject absurdly large uploads outright
  const TARGET_SIZE = 512; // resized square, keeps the base64 payload reasonable

  function showAvatarError(msg) {
    const el = document.getElementById('avatar-error');
    if (el) el.textContent = msg || '';
  }

  /** Resize/compress an image file down to a square JPEG data URL. */
  function fileToResizedDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read that file.'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('That file isn\'t a valid image.'));
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = TARGET_SIZE;
          canvas.height = TARGET_SIZE;
          const ctx = canvas.getContext('2d');

          // Cover-crop to a centered square.
          const side = Math.min(img.width, img.height);
          const sx = (img.width - side) / 2;
          const sy = (img.height - side) / 2;
          ctx.drawImage(img, sx, sy, side, side, 0, 0, TARGET_SIZE, TARGET_SIZE);

          resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function handleAvatarFile(file) {
    showAvatarError('');
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      showAvatarError('Please choose a PNG, JPEG, WEBP or GIF image.');
      return;
    }
    if (file.size > MAX_RAW_BYTES) {
      showAvatarError('That file is too large. Please pick something under 8MB.');
      return;
    }

    try {
      const dataUrl = await fileToResizedDataUrl(file);
      const { user } = await api('/users/me/avatar', {
        method: 'PATCH',
        body: JSON.stringify({ imageDataUrl: dataUrl })
      });
      applyMyAvatarEverywhere(user.avatarImage);
    } catch (err) {
      showAvatarError(err.message || 'Could not update your profile picture.');
    }
  }

  async function removeAvatar() {
    showAvatarError('');
    try {
      const { user } = await api('/users/me/avatar', { method: 'DELETE' });
      applyMyAvatarEverywhere(user.avatarImage);
    } catch (err) {
      showAvatarError(err.message || 'Could not remove your profile picture.');
    }
  }

  function applyMyAvatarEverywhere(avatarImage) {
    const user = getUser();
    user.avatarImage = avatarImage;
    setSession(getToken(), user);

    paintAvatar(document.getElementById('settings-pic-preview'), { name: user.fullName, color: user.avatarColor, image: avatarImage });
    paintAvatar(document.getElementById('my-avatar'), { name: user.fullName, color: user.avatarColor, image: avatarImage });

    if (window.Whispr.onMyAvatarChanged) window.Whispr.onMyAvatarChanged(avatarImage);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const user = getUser();
    if (!user) return;

    paintAvatar(document.getElementById('settings-pic-preview'), { name: user.fullName, color: user.avatarColor, image: user.avatarImage });

    document.getElementById('avatar-file-input')?.addEventListener('change', (e) => {
      handleAvatarFile(e.target.files[0]);
      e.target.value = '';
    });
    document.getElementById('remove-avatar-btn')?.addEventListener('click', removeAvatar);
  });

  window.Whispr = window.Whispr || {};
  Object.assign(window.Whispr, { fileToResizedDataUrl, ALLOWED_AVATAR_TYPES: ALLOWED_TYPES });
})();
