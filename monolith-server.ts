import express from "express";

// Ressource partagée simulant une base de données lente
let sharedCounter = 0;

// Ressource partagée supplémentaire : solde d'un compte utilisateur
let userAccount = {
    balance: 1000
};

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function heavyComputation(n: number): Promise<number> {
    let result = 0;
    for (let i = 0; i < n * 1e6; i++) {
        result += Math.sqrt(i % 1000);
    }
    return result;
}

async function slowFactorial(n: number): Promise<number> {
    if (n <= 1) return 1;
    let result = 1;
    for (let i = 2; i <= n; i++) {
        await sleep(200); // Simule latence
        result *= i;
    }
    return result;
}

async function slowFibonacci(n: number): Promise<number> {
    if (n <= 1) return n;
    await sleep(200); // Simule latence
    return (await slowFibonacci(n - 1)) + (await slowFibonacci(n - 2));
}

async function incrementSharedCounter(): Promise<number> {
    const start = Date.now();
    await sleep(5000); // Simule latence
    sharedCounter++;
    return sharedCounter;
}

// Fonction d'attente synchrone (bottleneck)
async function slowOperation(): Promise<void> {
    const start = Date.now();
    await sleep(20000); // Simule latence
    console.log("Opération lente terminée");
}

const app = express();
app.use(express.json());
app.use(function(req, res, next){
    req.setTimeout(2000, function(){
        console.log("Request has timed out.");
        res.status(503).send("Service unavailable. Please retry.");
    });
    next();
});

app.get("/compute", (req, res) => {
    const result = heavyComputation(10);
    res.json({ result });
});

app.get("/counter", (req, res) => {
    const value = incrementSharedCounter();
    res.json({ counter: value });
});

app.get("/slow", (req, res) => {
    const message = slowOperation();
    res.status(200).send();
});

// Nouveau endpoint : calcul factoriel très lent
app.get("/factorial/:n", (req, res) => {
    const n = parseInt(req.params.n, 10);
    if (isNaN(n) || n < 0 || n > 15) {
        return res.status(400).json({ error: "Paramètre invalide (0 <= n <= 15 recommandé)" });
    }
    const result = slowFactorial(n);
    res.json({ n, factorial: result });
});

// Nouveau endpoint : calcul de Fibonacci très lent
app.get("/fibonacci/:n", (req, res) => {
    const n = parseInt(req.params.n, 10);
    if (isNaN(n) || n < 0 || n > 25) {
        return res.status(400).json({ error: "Paramètre invalide (0 <= n <= 25 recommandé)" });
    }
    const result = slowFibonacci(n);
    res.json({ n, fibonacci: result });
});

// Deux endpoints dépendant de la même ressource partagée (userAccount)
app.post("/deposit", async (req, res) => {
    const amount = Number(req.body.amount);
    if (isNaN(amount) || amount <= 0) {
        return res.status(400).json({ error: "Montant invalide" });
    }
    await sleep(500);
    userAccount.balance += amount;
    res.json({ balance: userAccount.balance });
});

app.post("/withdraw", async (req, res) => {
    const amount = Number(req.body.amount);
    if (isNaN(amount) || amount <= 0) {
        return res.status(400).json({ error: "Montant invalide" });
    }
    const start = Date.now();
    await sleep(200); // Simule latence
    if (userAccount.balance < amount) {
        return res.status(400).json({ error: "Fonds insuffisants" });
    }
    userAccount.balance -= amount;
    res.json({ balance: userAccount.balance });
});

app.get("/account", (req, res) => {
    res.json({ balance: userAccount.balance });
});

app.get("/health", (req, res) => {
    res.json({ status: "ok" });
});

app.listen(3000, () => {
    console.log("Serveur monolithique Express démarré sur http://localhost:3000");
    console.log("Endpoints : /compute, /counter, /slow, /factorial/:n, /fibonacci/:n, /deposit, /withdraw, /account, /health");
});
