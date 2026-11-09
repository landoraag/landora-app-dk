// Aba Prospecção: o Radar de Prospecção (pasta radar-prospeccao/) carregado dentro do app.
// A página /radar/ roda no mesmo endereço do app, então o login é o mesmo e não pede senha de novo.
export default function Prospeccao() {
  return (
    <div className="radar-tab">
      <iframe className="radar-frame" src="/radar/?embed=1#inicio" title="Radar de Prospecção" allow="clipboard-write; geolocation" />
    </div>
  );
}
