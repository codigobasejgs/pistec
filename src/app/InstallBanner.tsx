import { useState } from 'react';
import { Download, PlusSquare, RefreshCw, Share, WifiOff, X } from 'lucide-react';
import { Modal } from '../ui';
import { applyUpdate, isIOS, isStandalone, promptInstall, usePwa } from '../pwa';

const KEY = 'pistec-install-dismissed';
const dismissedUntil = () => { try { return Number(localStorage.getItem(KEY) || 0); } catch { return 0; } };

/** Avisos do PWA: instalação (discreta, dispensável), nova versão e modo offline. Montado uma vez na raiz. */
export default function PwaNotices() {
  const { installPrompt, waiting, online } = usePwa();
  const [hidden, setHidden] = useState(() => isStandalone() || Date.now() < dismissedUntil());
  const [iosHelp, setIosHelp] = useState(false);
  const ios = isIOS();
  const dismiss = (days: number) => { setHidden(true); try { localStorage.setItem(KEY, String(Date.now() + days * 864e5)); } catch { /* preferência opcional */ } };
  // Só oferece instalar quando há como instalar de fato: prompt nativo (Chrome/Edge) ou instruções (iOS Safari).
  const canInstall = !hidden && (installPrompt || ios);
  return <>
    {!online && <div className="offline-pill" role="status"><WifiOff size={14} aria-hidden="true"/>Sem conexão com o servidor · dados locais disponíveis<button className="text-button" onClick={() => dispatchEvent(new Event('pistec:check-connection'))}>Verificar conexão</button></div>}
    {waiting && <aside className="pwa-banner" role="status" aria-label="Nova versão disponível">
      <div className="pwa-banner-content"><RefreshCw size={20} aria-hidden="true"/><div className="pwa-banner-text"><strong>Nova versão do PISTEC disponível</strong><span>Atualize quando terminar a operação atual. Seus dados locais são mantidos.</span></div></div>
      <div className="pwa-banner-actions"><button className="btn primary btn-sm" onClick={() => applyUpdate()}>Atualizar agora</button></div>
    </aside>}
    {!waiting && canInstall && <aside className="pwa-banner" aria-label="Instalar aplicativo PISTEC">
      <div className="pwa-banner-content"><img src="/icons/icon-48x48.png" alt="" width="36" height="36" className="pwa-banner-icon"/><div className="pwa-banner-text"><strong>Instale o PISTEC neste dispositivo</strong><span>Abra direto da tela inicial, em janela própria.</span></div></div>
      <div className="pwa-banner-actions">
        <button className="btn ghost btn-sm" onClick={() => dismiss(7)}>Agora não</button>
        <button className="btn primary btn-sm" onClick={async () => { if (installPrompt) { const r = await promptInstall(); dismiss(r === 'accepted' ? 365 : 7); } else setIosHelp(true); }}><Download size={14} aria-hidden="true"/>{installPrompt ? 'Instalar' : 'Como instalar'}</button>
        <button className="icon-button btn-sm" aria-label="Fechar aviso de instalação" onClick={() => dismiss(7)}><X size={14}/></button>
      </div>
    </aside>}
    <Modal title="Instalar no iPhone ou iPad" open={iosHelp} onClose={() => setIosHelp(false)} footer={<button className="btn primary" onClick={() => { setIosHelp(false); dismiss(30); }}>Entendi</button>}>
      <div className="ios-install-steps"><p>No Safari a instalação é manual:</p><ol>
        <li>Toque em <strong>Compartilhar</strong> <Share size={15} aria-hidden="true"/> na barra do Safari.</li>
        <li>Escolha <strong>Adicionar à Tela de Início</strong> <PlusSquare size={15} aria-hidden="true"/>.</li>
        <li>Confirme em <strong>Adicionar</strong>.</li></ol>
        <p className="muted small">Em outros navegadores do iPhone a opção pode não existir; use o Safari.</p></div>
    </Modal>
  </>;
}
