// Gera o instalador de teste (Windows/NSIS) já apontando para um servidor na rede local.
// Uso: npm run installer -w desktop [-- http://IP:3001]   (sem argumento, usa o IP desta máquina)
const os = require('node:os');
const path = require('node:path');
const builder = require('electron-builder');

function lanAddress() {
  const candidates = Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'));
  // Redes domésticas (192.168.x) primeiro.
  candidates.sort((a, b) => b.address.startsWith('192.168.') - a.address.startsWith('192.168.'));
  if (!candidates.length) throw new Error('Nenhum endereço de rede encontrado; passe a URL como argumento.');
  return candidates[0].address;
}

const serverUrl = new URL(process.argv[2] ?? `http://${lanAddress()}:3001`).origin;
const electronVersion = require('electron/package.json').version;
console.log(`Servidor gravado no instalador: ${serverUrl}`);

builder
  .build({
    projectDir: path.join(__dirname, '..'),
    targets: builder.Platform.WINDOWS.createTarget('nsis', builder.Arch.x64),
    config: {
      appId: 'local.clone.teste',
      productName: 'Clone Local (teste)',
      electronVersion,
      npmRebuild: false,
      files: ['src/**/*', 'package.json'],
      // Nome próprio: perfil (userData) e trava de instância única separados do app de desenvolvimento.
      extraMetadata: { name: 'clone-local-teste', productName: 'Clone Local (teste)', cloneServerUrl: serverUrl },
      directories: { output: path.join(__dirname, '..', '..', 'release') },
      win: { signAndEditExecutable: false },
      nsis: {
        oneClick: false,
        perMachine: false,
        allowToChangeInstallationDirectory: true,
        shortcutName: 'Clone Local (teste)',
        artifactName: 'Clone-Local-teste-Setup.${ext}',
      },
    },
  })
  .then((files) => console.log(`Pronto:\n${files.join('\n')}`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
