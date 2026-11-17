import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { api } from '../lib/api.js';
import { navigate } from '../lib/router.js';
import ConcursoForm from '../components/ConcursoForm.jsx';
import { Spinner, useToast, EmptyState } from '../components/ui.jsx';

export default function EditarConcurso({ id }) {
  const [c, setC] = useState(null);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => { api.getConcurso(id).then(setC).catch((e) => setErr(e.message)); }, [id]);

  if (err) return <EmptyState title="Não foi possível carregar">{err}</EmptyState>;
  if (!c) return <div className="page-loading"><Spinner size={28} /></div>;

  const save = async (data) => {
    setSaving(true);
    try {
      // Provas são editadas na aba própria; não as enviamos aqui para evitar sobrescrita.
      const { provas, monitor, ...rest } = data;
      await api.updateConcurso(id, rest);
      toast('Alterações salvas.');
      navigate(`/concurso/${id}`, { replace: true });
    } catch (e) {
      toast(e.message, { type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="narrow wide-when-form">
      <a href={`#/concurso/${id}`} className="back-link"><ArrowLeft size={16} /> Voltar ao concurso</a>
      <h1>Editar concurso</h1>
      <p className="muted">{c.orgao}</p>
      <ConcursoForm initial={c} saving={saving} submitLabel="Salvar alterações" onCancel={() => navigate(`/concurso/${id}`)} onSubmit={save} />
    </div>
  );
}
