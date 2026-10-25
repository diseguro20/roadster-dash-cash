# Roadster Dash Cash 🏎️💨💰

Uma plataforma completa de jogo de corrida e habilidade com apostas em tempo real e saques/depósitos automáticos via PIX com **VizzionPay** e banco de dados **Firebase Firestore**.

O jogo preserva 100% da física original, gráficos 3D WebGL (Tesla Roadster, efeitos de propulsores, tráfego dinâmico) e áudio sintetizado do Roadster Dash, integrando uma mecânica de aposta por habilidade (Crash & Runner Wagering) inspirada no Fruit Cash.

---

## ⚡ Como Funciona a Aposta por Habilidade

1. **Escolha da Aposta**:
   - O piloto escolhe o valor da aposta (R$ 1, R$ 2, R$ 5, R$ 10, R$ 20, R$ 50, R$ 100 ou personalizado).
   - Pode jogar no modo **Valendo Dinheiro Real** ou praticar no **Modo Treino**.
2. **Corrida & Multiplicador Progressivo**:
   - O Tesla acelera pelo tráfego. Quanto mais longe e mais manobras você fizer sem colidir, maior o multiplicador da sua aposta (1.10x, 1.50x, 2.00x, 3.50x, 5.00x, 10.00x+).
3. **Resgate Instantâneo (Cashout)**:
   - Aperte o botão **RESGATAR** na tela ou a tecla **ESPAÇO** a qualquer momento antes de bater para garantir o lucro!
   - O prêmio é creditado instantaneamente no saldo da sua conta.
4. **Batida no Tráfego (Crash)**:
   - Se o veículo bater antes do resgate, a corrida é encerrada e a aposta é perdida.

---

## 💰 Pagamentos e Depósitos PIX

- **VizzionPay Oficial**: Geração de QR Code e código Copia e Cola instantâneo.
- **Verificação Automática**: O sistema consulta o pagamento a cada poucos segundos e atualiza o saldo do jogador na hora sem recarregar a página.
- **Webhooks**: Notificações automáticas do banco para aprovação imediata.
- **Saques**: Solicitação de saque direto para qualquer chave PIX (CPF, Celular, E-mail ou EVP).

---

## 🚀 Como Executar Localmente

1. Instale as dependências:
   ```bash
   npm install
   ```

2. Inicie o servidor:
   ```bash
   npm start
   ```

3. Abra no navegador:
   👉 **http://localhost:3005**

---

## ☁️ Deploy na Vercel

O projeto já inclui `vercel.json` configurado para Vercel Serverless com Express.
As variáveis de ambiente necessárias estão documentadas em `.env.example`.
