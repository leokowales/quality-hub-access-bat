# QualityHub pelo BAT

Distribuição local para Windows, por usuário, sem VS Code. O backend e o banco
permanecem na máquina. Requer Git, Python 3.14, Node.js 24 com npm e Google Chrome.

## Primeira instalação

Baixe `Preparar QualityHub.bat` deste repositório e execute com seu usuário normal.
Ele clona a branch `main` de `https://github.com/leokowales/quality-hub-access-bat.git`
em `%USERPROFILE%\QualityHubBAT`, prepara as dependências e cria atalhos.
Não sobrescreve uma pasta existente. Downloads de dependências precisam de rede.
Se a preparação falhar, preserve a pasta e a mensagem para suporte.

Para concluir manualmente uma preparação interrompida, abra PowerShell na pasta
clonada e execute cada comando, parando se algum falhar:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
.\.venv\Scripts\python.exe -m pip check
npm.cmd ci
npm.cmd run build
& '.\QualityHub.bat' --atalhos
```

Abra `QualityHub.bat`. Fechar a janela do QualityHub encerra seus serviços.
A licença individual é entregue separadamente e fica em
`%LOCALAPPDATA%\QualityHub\data\authorization.lic`.
Não copie dados, licenças ou credenciais de outra pessoa.

## Atualização

Na tela de atualizações, escolha `Atualizar agora` e confirme após salvar o trabalho.
O atualizador consulta o Git; se houver nova versão, fecha o aplicativo, cria backup
SQLite consistente, aplica avanço direto, instala dependências, valida o build,
executa migrações e reabre o sistema. Pode ser necessário entrar novamente.
Se já estiver atualizado, a janela permanece aberta.

`Atualizar QualityHub.bat` é a alternativa quando a interface não abre e também
permite consultar o resultado no console. Logs ficam em `logs/local/update.log`
e `logs/local/update-launch.log`. Backups ficam ao lado do banco ativo.
Falhas interrompem a atualização; não há retorno automático completo de código e
dependências. Preserve os backups e procure suporte. Nunca apague o banco nem
execute `git reset` para resolver falhas.

Uma cópia antiga extraída de ZIP não acompanha o Git: faça uma instalação nova na
pasta indicada, mantendo a antiga fechada e preservada. O modo operacional usa a
mesma pasta de dados do mesmo usuário Windows; homologação possui dados separados.

## Publicação e quatro modos de acesso

Local de desenvolvimento e web de homologação continuam disponíveis para testes.
Desktop EXE e BAT são canais de distribuição e devem receber a mesma versão
funcional depois da aprovação. Testes automatizados não substituem homologação.

No repositório de desenvolvimento, exporte os arquivos para uma pasta nova:

```powershell
.\.venv\Scripts\python.exe desktop\prepare_bat_distribution.py --version VERSAO_APROVADA --manifest build\distribution\VERSAO_APROVADA-reviewed\latest.json --output build\bat\VERSAO_APROVADA
```

O manifesto da mesma versão desktop também alimenta os avisos do canal BAT;
o botão do BAT sempre aplica o Git, sem baixar o instalador EXE.
Revise `distribution-audit.json`, fontes e imagens antes de publicar. A busca
automática é parcial e não certifica ausência de dados sensíveis. A exportação
não inclui histórico Git, bancos, licenças, `.env`, chaves privadas, logs, imagens
de homologação nem ferramentas de emissão de licenças. Não copie toda a pasta.
Na primeira publicação, crie histórico próprio. Nas seguintes, atualize os arquivos
controlados no clone de distribuição, preservando `.git` e revisando remoções.
Não force-push nem reescreva o histórico que os clientes acompanham.

Antes de publicar uma correção aprovada: defina uma versão comum; valide o BAT em
instalação limpa e em atualização com dados; gere e valide o EXE; registre aprovação
manual e resultados dos dois canais. Só então publique ambos e suas notas.
Se um canal falhar, a entrega dos dois canais permanece pendente.
Publicação é manual; exportar não cria commits nem envia arquivos ao GitHub.
