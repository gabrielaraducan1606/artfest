// src/pages/ContractPage.jsx
import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../../api';
import Navbar from '../../../components/Navbar/Navbar';
import styles from './ContractPage.module.css';

function SignaturePad({ onChange }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // HiDPI scaling
    const ratio = window.devicePixelRatio || 1;
    const cssWidth = 600;
    const cssHeight = 200;
    canvas.width = cssWidth * ratio;
    canvas.height = cssHeight * ratio;
    canvas.style.width = cssWidth + 'px';
    canvas.style.height = cssHeight + 'px';
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#000';

    const getPos = (evt) => {
      const rect = canvas.getBoundingClientRect();
      const clientX = 'clientX' in evt ? evt.clientX : (evt.touches?.[0]?.clientX ?? 0);
      const clientY = 'clientY' in evt ? evt.clientY : (evt.touches?.[0]?.clientY ?? 0);
      return { x: clientX - rect.left, y: clientY - rect.top };
    };

    const start = (evt) => {
      evt.preventDefault?.();
      drawing.current = true;
      ctx.beginPath();
      const { x, y } = getPos(evt);
      ctx.moveTo(x, y);
    };

    const move = (evt) => {
      if (!drawing.current) return;
      evt.preventDefault?.();
      const { x, y } = getPos(evt);
      ctx.lineTo(x, y);
      ctx.stroke();
    };

    const end = (evt) => {
      if (!drawing.current) return;
      evt?.preventDefault?.();
      drawing.current = false;
      onChange(canvas.toDataURL('image/png'));
    };

    // Memorize handlers to remove correctly
    const onMouseDown = (e) => start(e);
    const onMouseMove = (e) => move(e);
    const onMouseUp   = (e) => end(e);

    const onTouchStart = (e) => start(e);
    const onTouchMove  = (e) => move(e);
    const onTouchEnd   = (e) => end(e);

    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });

    return () => {
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);

      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
    };
  }, [onChange]);

  const clear = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    onChange(null);
  };

  return (
    <div>
      <canvas ref={canvasRef} className={styles.signatureCanvas} />
      <button type="button" className={styles.clearBtn} onClick={clear}>
        Șterge semnătura
      </button>
    </div>
  );
}

const ContractPage = () => {
  const { id } = useParams(); // contract id
  const navigate = useNavigate();
  const [contract, setContract] = useState(null);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState(false);
  const [signerName, setSignerName] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [signatureDataUrl, setSignatureDataUrl] = useState(null);

  // (opțional) precompletare din profil
  useEffect(() => {
    const preload = async () => {
      try {
        const { data } = await api.get('/api/seller/me', {
          headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
        });
        if (data?.email && !signerEmail) setSignerEmail(data.email);
        if (data?.shopName && !signerName) setSignerName(data.shopName);
      } catch {
        // e ok dacă nu avem profil
      }
    };
    preload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // doar o dată

  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await api.get(`/api/contracts/${id}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
        });
        setContract(data);
      } catch {
        alert('Nu am putut încărca contractul.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  const handleSign = async (e) => {
    e.preventDefault();
    if (!signerName || !signerEmail || !signatureDataUrl) {
      alert('Completează nume, email și semnătura.');
      return;
    }
    setSigning(true);
    try {
      const { data } = await api.post(
        `/api/contracts/${id}/sign`,
        { signerName, signerEmail, signatureImageBase64: signatureDataUrl },
        { headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` } }
      );

      alert('Contract semnat cu succes!');
      setContract((c) => ({
        ...c,
        status: 'signed',
        pdfUrl: data.pdfUrl,
        signedAt: new Date().toISOString(),
      }));
    } catch (err) {
      alert('Eroare la semnare: ' + (err.response?.data?.msg || err.message));
    } finally {
      setSigning(false);
    }
  };

  if (loading) return <div>Se încarcă…</div>;

  return (
    <>
      <Navbar />
      <div className={styles.container}>
        <div className={styles.form}>
          <h2 className={styles.title}>Contract de colaborare</h2>

          {contract?.pdfUrl ? (
            <div className={styles.preview}>
              <a href={contract.pdfUrl} target="_blank" rel="noreferrer">
                Deschide PDF
              </a>
            </div>
          ) : (
            <p>Nu există încă un PDF generat.</p>
          )}

          {contract?.status !== 'signed' ? (
            <>
              <p style={{ color: '#555' }}>
                Te rugăm să verifici informațiile din contract. Pentru a finaliza, semnează mai jos.
              </p>

              <label>
                Nume semnatar
                <input
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                  placeholder="Nume complet"
                  required
                />
              </label>

              <label>
                Email semnatar
                <input
                  type="email"
                  value={signerEmail}
                  onChange={(e) => setSignerEmail(e.target.value)}
                  placeholder="email@exemplu.ro"
                  required
                />
              </label>

              <label>Semnează în caseta de mai jos:</label>
              <SignaturePad onChange={setSignatureDataUrl} />

              <button
                onClick={handleSign}
                disabled={signing || !signerName || !signerEmail || !signatureDataUrl}
              >
                {signing ? 'Se semnează…' : 'Semnează contractul'}
              </button>
            </>
          ) : (
            <>
              <p style={{ color: 'green' }}>
                Contract semnat pe {new Date(contract.signedAt).toLocaleString()}
              </p>
              <a
                className={styles.downloadBtn}
                href={contract.pdfUrl}
                target="_blank"
                rel="noreferrer"
              >
                Descarcă PDF semnat
              </a>
              <button
                type="button"
                className={styles.skipButton}
                onClick={() => navigate('/vanzator/dashboard')}
              >
                Mergi la Dashboard
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default ContractPage;
