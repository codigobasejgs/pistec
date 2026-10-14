import { useEffect, useState } from 'react';
import { Download, Share2, X, PlusSquare } from 'lucide-react';
import { Modal } from '../ui';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function InstallBanner() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSModal, setShowIOSModal] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    // 1. Já está em modo standalone (PWA instalado e rodando em janela própria)?
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (isStandalone) return;

    // 2. Foi dispensado recentemente (7 dias)?
    try {
      const until = Number(localStorage.getItem('pistec-install-dismissed') || 0);
      if (Date.now() < until) return;
    } catch {
      // localStorage indisponível
    }

    // 3. Detecção iOS / iPadOS
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream;
    setIsIOS(ios);

    // 4. Captura do evento de instalação (Chrome, Edge, Android)
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setDismissed(false);
    };

    window.addEventListener('beforeinstallprompt', handler);

    // No iOS, se não for standalone e não foi dispensado, pode exibir após 5s
    if (ios) {
      const timer = setTimeout(() => setDismissed(false), 4000);
      return () => {
        clearTimeout(timer);
        window.removeEventListener('beforeinstallprompt', handler);
      };
    }

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const dismiss = (days = 7) => {
    setDismissed(true);
    setDeferred(null);
    try {
      localStorage.setItem('pistec-install-dismissed', String(Date.now() + days * 86400000));
    } catch {
      // Ignora erro de storage
    }
  };

  const install = async () => {
    if (deferred) {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === 'accepted') {
        dismiss(60);
      } else {
        dismiss(3);
      }
    } else if (isIOS) {
      setShowIOSModal(true);
    }
  };

  if (dismissed || (!deferred && !isIOS)) return null;

  return (
    <>
      <aside className="pwa-banner" role="complementary" aria-label="Instalar aplicativo PISTEC">
        <div className="pwa-banner-content">
          <img src="/icons/icon-48x48.png" alt="" width="36" height="36" className="pwa-banner-icon" />
          <div className="pwa-banner-text">
            <strong>Instale o PISTEC no seu dispositivo</strong>
            <span>Acesse mais rápido direto da sua tela inicial ou desktop.</span>
          </div>
        </div>
        <div className="pwa-banner-actions">
          <button className="btn ghost btn-sm" onClick={() => dismiss(7)}>
            Agora não
          </button>
          <button className="btn primary btn-sm" onClick={install}>
            <Download size={14} aria-hidden="true" />
            {isIOS ? 'Como instalar' : 'Instalar'}
          </button>
          <button className="icon-button btn-sm" aria-label="Fechar aviso" onClick={() => dismiss(7)}>
            <X size={14} />
          </button>
        </div>
      </aside>

      {/* Modal explicativo específico para iOS / iPadOS */}
      <Modal
        title="Instalar no iPhone / iPad"
        open={showIOSModal}
        onClose={() => setShowIOSModal(false)}
        footer={
          <button className="btn primary" onClick={() => { setShowIOSModal(false); dismiss(14); }}>
            Entendi
          </button>
        }
      >
        <div className="ios-install-steps">
          <p>O Safari no iOS não permite instalação automática por botão. Siga estes passos simples:</p>
          <ol>
            <li>
              Toque no botão de <strong>Compartilhar</strong> <Share2 size={16} style={{ display: 'inline', verticalAlign: 'middle' }} /> na barra inferior do Safari.
            </li>
            <li>
              Role para baixo e selecione <strong>Adicionar à Tela de Início</strong> <PlusSquare size={16} style={{ display: 'inline', verticalAlign: 'middle' }} />.
            </li>
            <li>
              Toque em <strong>Adicionar</strong> no canto superior direito.
            </li>
          </ol>
          <p className="muted small">O PISTEC aparecerá na sua tela de início como um aplicativo dedicado, abrindo em tela cheia.</p>
        </div>
      </Modal>
    </>
  );
}
