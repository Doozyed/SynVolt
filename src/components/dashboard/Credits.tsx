import { openUrl } from '@tauri-apps/plugin-opener';

const discordInvite = 'https://discord.gg/lumadw';

export function Credits() {
  const openDiscord = () => {
    void openUrl(discordInvite).catch(() => {
      window.alert('Could not open Discord. Visit discord.gg/lumadw in your browser.');
    });
  };

  return (
    <div className="credits">
      <strong className="credits-title">Credits</strong>
      <div className="credits-list">
        <div><span>API:</span> Synz Dev team</div>
        <div><span>UI:</span> doozyed_d</div>
        <div><span>Helper:</span> 1llusion_.z</div>
      </div>
      <button type="button" className="credits-link" onClick={openDiscord}>
        Join discord.gg/lumadw
      </button>
    </div>
  );
}
