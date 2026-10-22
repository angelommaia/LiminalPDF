# Compilar o LiminalPDF no Windows

Guia do zero até o `.exe`, para Windows 10 ou 11 (64 bits). São cinco programas, instalados uma única vez:

| O quê | Para quê | Precisa de admin? |
| --- | --- | --- |
| Node.js 20+ | Compilar a interface (TypeScript) | Sim (instalador oficial) |
| Microsoft C++ Build Tools | O compilador e o *linker* que o Rust usa no Windows | Sim |
| Rust (via rustup) | Compilar a parte nativa | **Não**, instala na sua pasta de usuário |
| WebView2 | Motor que desenha a janela | Já vem no Windows 10 (1803+) e 11 |
| Git (opcional) | Versionar e publicar no GitHub | Sim |

Reserve uns **8 GB de disco**, a maior parte para o Build Tools. A primeira compilação do LiminalPDF baixa e compila cerca de 400 bibliotecas: leva vários minutos. As seguintes levam segundos.

> **Não tem administrador?** Pule para [Compilar sem instalar nada](#compilar-sem-instalar-nada): o GitHub compila por você.

---

## Antes de começar: tire o projeto do OneDrive

A pasta `src-tauri/target/` passa de 2 GB depois da primeira compilação, com milhares de arquivos. Dentro do OneDrive, a sincronização fica tentando enviar tudo, deixa a compilação lenta e às vezes trava arquivos no meio do processo.

Mova o projeto para uma pasta fora dele, por exemplo `Documentos\LiminalPDF`, e use o Git + GitHub como cópia de segurança.

Se preferir manter no OneDrive, faça o Rust compilar em outra pasta. Rode isto uma vez no PowerShell:

```powershell
setx CARGO_TARGET_DIR "$env:LOCALAPPDATA\liminalpdf-target"
```

Feche e reabra o terminal. O `.exe` passa a sair em `%LOCALAPPDATA%\liminalpdf-target\release\` em vez de `src-tauri\target\release\`.

---

## Passo 1 · Node.js

Abra o **PowerShell** (menu Iniciar → digite *PowerShell*) e confira:

```powershell
node -v
```

Se aparecer `v20` ou maior, pule para o passo 2. Se não, instale a versão LTS:

- pelo site: [nodejs.org](https://nodejs.org) → botão **LTS** → instalador padrão, tudo em *Next*; ou
- pelo terminal: `winget install --id OpenJS.NodeJS.LTS -e`

Feche e reabra o PowerShell e rode `node -v` de novo.

## Passo 2 · Microsoft C++ Build Tools

Este é o passo mais longo, e o mais importante: sem ele o Rust não consegue gerar `.exe` e você verá o erro ``linker `link.exe` not found``.

### Opção A · pelo instalador (recomendada)

1. Acesse [visualstudio.microsoft.com/visual-cpp-build-tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) e clique em **Baixar Build Tools**.
2. Execute o `vs_BuildTools.exe` e aceite o pedido de administrador.
3. Na aba **Cargas de trabalho**, marque **Desenvolvimento para desktop com C++** (*Desktop development with C++*).
4. No painel da direita, confira se estão marcados:
   - **MSVC … Ferramentas de build C++ x64/x86** (a versão mais recente)
   - **SDK do Windows 11** (ou do Windows 10)
5. Clique em **Instalar** e espere terminar. Se pedir, reinicie o computador.

Não precisa instalar o Visual Studio completo, só o Build Tools.

### Opção B · por uma linha de comando

Em um PowerShell **aberto como administrador** (botão direito → *Executar como administrador*):

```powershell
winget install --id Microsoft.VisualStudio.BuildTools -e --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

Uma janela de progresso aparece e fecha sozinha ao terminar. Se o `winget` disser que não encontrou o pacote, troque o ID por `Microsoft.VisualStudio.2022.BuildTools`.

## Passo 3 · Rust

Instale **depois** do Build Tools: assim o instalador do Rust já encontra o compilador da Microsoft e não pergunta nada.

### Opção A · pelo instalador (recomendada)

1. Acesse [rustup.rs](https://rustup.rs) e baixe o **rustup-init.exe (64 bits)**.
2. Execute. Abre uma janela de terminal.
3. Ela mostra um resumo com `default host triple: x86_64-pc-windows-msvc`. Confirme que termina em **`-msvc`**.
4. Escolha **`1) Proceed with standard installation`**: é só apertar **Enter**.
5. Quando aparecer `Rust is installed now. Great!`, aperte Enter para fechar.

Se em vez do resumo aparecer um aviso dizendo que faltam os pré-requisitos do Visual C++, o passo 2 não terminou direito. Escolha **3) Don't install the prerequisites**, volte ao passo 2 e depois rode o `rustup-init.exe` de novo.

### Opção B · pelo terminal

```powershell
winget install --id Rustlang.Rustup -e
```

### Depois de qualquer uma das opções

**Feche e abra um novo PowerShell.** O Rust é adicionado ao `PATH` e só terminais novos enxergam isso.

## Passo 4 · Verificar

```powershell
rustc --version
cargo --version
rustup show
```

Os dois primeiros mostram números de versão. No `rustup show`, a linha `Default host` precisa terminar em `-pc-windows-msvc`. Se terminar em `-gnu`, corrija com:

```powershell
rustup default stable-msvc
```

O WebView2 você pode conferir em *Configurações → Aplicativos → Aplicativos instalados*: procure **Microsoft Edge WebView2 Runtime**. Se não estiver lá (Windows antigo), instale o *Evergreen Bootstrapper* em [developer.microsoft.com/microsoft-edge/webview2](https://developer.microsoft.com/microsoft-edge/webview2/#download-section).

## Passo 5 · Compilar o LiminalPDF

Na pasta do projeto:

```powershell
cd $HOME\Documents\LiminalPDF
npm install
```

Para abrir o app em modo de desenvolvimento, que recarrega a cada alteração no código:

```powershell
npm run desktop
```

Para gerar o executável final:

```powershell
npm run desktop:build
```

Ou use `.\scripts\build.ps1`, que faz o mesmo e copia tudo para `release\`. Os resultados:

- `src-tauri\target\release\liminalpdf.exe`: **portátil**, um arquivo só, roda sem instalar nem admin
- `src-tauri\target\release\bundle\nsis\LiminalPDF_x.y.z_x64-setup.exe`: instalador para o usuário atual, sem admin, que registra o "Abrir com…" para PDFs

## Manutenção

```powershell
rustup update        # atualiza o Rust (de vez em quando)
cargo clean --manifest-path src-tauri/Cargo.toml   # apaga a pasta target se ela ficar grande demais
```

Para desinstalar: `rustup self uninstall` remove o Rust; o Build Tools sai pelo **Visual Studio Installer**.

---

## Problemas comuns

**``linker `link.exe` not found``** ou **`could not find native static library`**

O Build Tools não está instalado ou falta a carga *Desenvolvimento para desktop com C++*. Abra o **Visual Studio Installer** → **Modificar** → marque a carga → **Modificar**. Depois, abra um terminal novo.

**`cargo` ou `rustc` não é reconhecido como comando**

O terminal foi aberto antes da instalação. Feche e abra outro. Se continuar, confira se `%USERPROFILE%\.cargo\bin` está no `PATH`: *Configurações → Sistema → Sobre → Configurações avançadas do sistema → Variáveis de Ambiente*.

**`npm` dá erro de "execução de scripts foi desabilitada neste sistema"**

É a política do PowerShell. Libere para o seu usuário (não precisa de admin):

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Ou use `npm.cmd` no lugar de `npm`.

**A compilação está muito lenta ou falha com "acesso negado" em arquivos dentro de `target`**

Quase sempre é o OneDrive ou o antivírus mexendo na pasta durante a compilação. Veja [Antes de começar](#antes-de-começar-tire-o-projeto-do-onedrive). Se for o antivírus, adicione uma exclusão para a pasta `target`.

**O app abre uma janela em branco**

Falta o WebView2 (veja o passo 4) ou a pasta `dist/` está vazia. Rode `npm run build` e confira que `dist\index.html` existe.

---

## Compilar sem instalar nada

O workflow [`.github/workflows/release.yml`](../.github/workflows/release.yml) compila o LiminalPDF para Windows, Linux e macOS nos servidores do GitHub, de graça para repositórios públicos.

1. Crie o repositório no GitHub e envie o projeto.
2. No GitHub, aba **Actions** → **release** → **Run workflow**.
3. Em cerca de 15 minutos, os arquivos aparecem no fim da página da execução, em **Artifacts**.

Para publicar uma versão, crie uma tag (`git tag v0.1.0` e `git push origin v0.1.0`): o workflow gera um rascunho em **Releases** com o instalador, o `.exe` portátil e as versões para Linux e macOS.
