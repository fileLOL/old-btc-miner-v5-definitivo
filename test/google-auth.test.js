const assert=require('assert');
const path=require('path');
const fs=require('fs');
const {getDb,closeDb,resetDb}=require('../lib/db');
const accountManager=require('../lib/account-manager');
const SessionManager=require('../lib/session-manager');
const {verifyGoogleIdToken}=require('../lib/google-auth');

const TEST_DB_PATH=path.join(__dirname,'..','data','test-google-auth.db');
const GOOGLE_CLIENT_ID='test-client-id.apps.googleusercontent.com';

async function runTests(){
console.log('\n=== GOOGLE AUTH VERIFICATION TESTS ===\n');

if(fs.existsSync(TEST_DB_PATH)){fs.unlinkSync(TEST_DB_PATH)}
const db=getDb(TEST_DB_PATH);
console.log('[1] Database created');

console.log('\n[Test 1] Invalid token format (no dots)');
const invalidToken=await verifyGoogleIdToken('invalidtoken',GOOGLE_CLIENT_ID);
assert.strictEqual(invalidToken.valid,false);
assert.strictEqual(invalidToken.error,'invalid JWT structure');
console.log('  ✓ Invalid token rejected');

console.log('\n[Test 2] Empty token');
const emptyToken=await verifyGoogleIdToken('',GOOGLE_CLIENT_ID);
assert.strictEqual(emptyToken.valid,false);
console.log('  ✓ Empty token rejected');

console.log('\n[Test 3] Null token');
const nullToken=await verifyGoogleIdToken(null,GOOGLE_CLIENT_ID);
assert.strictEqual(nullToken.valid,false);
console.log('  ✓ Null token rejected');

console.log('\n[Test 4] Malformed JWT (missing parts)');
const malformedToken=await verifyGoogleIdToken('part1.part2',GOOGLE_CLIENT_ID);
assert.strictEqual(malformedToken.valid,false);
assert.strictEqual(malformedToken.error,'invalid JWT structure');
console.log('  ✓ Malformed JWT rejected');

console.log('\n[Test 5] Invalid JWT structure');
const invalidJwt=await verifyGoogleIdToken('not.base64.json!!!',GOOGLE_CLIENT_ID);
assert.strictEqual(invalidJwt.valid,false);
console.log('  ✓ Invalid JWT structure rejected');

console.log('\n[Test 6] Create account without Google (legacy)');
const legacyAccount=accountManager.getOrCreateAccount('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
assert.strictEqual(legacyAccount.isNew,true);
assert.strictEqual(legacyAccount.btc_address,'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
const identity1=accountManager.getIdentityByAccountId(legacyAccount.account_id);
assert.strictEqual(identity1,null);
console.log('  ✓ Legacy account created without identity');

console.log('\n[Test 7] Legacy account cannot be verified');
const isVerified=accountManager.isAccountVerified(legacyAccount.account_id);
assert.strictEqual(isVerified,false);
console.log('  ✓ Legacy account is not verified');

console.log('\n[Test 8] Create account with Google verification');
const verifiedAccount=accountManager.getOrCreateAccount('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
accountManager.createIdentity(verifiedAccount.account_id,'google-user-123','test@example.com','Test User');
const identity2=accountManager.getIdentityByAccountId(verifiedAccount.account_id);
assert.strictEqual(identity2.google_id,'google-user-123');
assert.strictEqual(identity2.email,'test@example.com');
assert.strictEqual(identity2.name,'Test User');
console.log('  ✓ Account created with Google identity');

console.log('\n[Test 9] Verified account is verified');
const isVerified2=accountManager.isAccountVerified(verifiedAccount.account_id);
assert.strictEqual(isVerified2,true);
console.log('  ✓ Verified account returns true');

console.log('\n[Test 10] Cannot create duplicate identity for same account');
let duplicateError=null;
try{
accountManager.createIdentity(verifiedAccount.account_id,'google-user-456','other@example.com','Other User');
}catch(e){
duplicateError=e.message;
}
assert.strictEqual(duplicateError,'identity already exists for this account');
console.log('  ✓ Duplicate identity rejected');

console.log('\n[Test 11] Cannot link same Google ID to different account');
const anotherAccount=accountManager.getOrCreateAccount('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');
let googleDuplicateError=null;
try{
accountManager.createIdentity(anotherAccount.account_id,'google-user-123','test@example.com','Test User');
}catch(e){
googleDuplicateError=e.message;
}
assert.strictEqual(googleDuplicateError,'google_id already linked to another account');
console.log('  ✓ Google ID reuse rejected');

console.log('\n[Test 12] Get identity by Google ID');
const foundIdentity=accountManager.getIdentityByGoogleId('google-user-123');
assert.strictEqual(foundIdentity.account_id,verifiedAccount.account_id);
assert.strictEqual(foundIdentity.email,'test@example.com');
console.log('  ✓ Identity found by Google ID');

console.log('\n[Test 13] Session with Google ID');
const sessionManager=new SessionManager();
const token=sessionManager.createSession(verifiedAccount.account_id,'google-user-123');
const session=sessionManager.validateSessionFull(token);
assert.strictEqual(session.accountId,verifiedAccount.account_id);
assert.strictEqual(session.googleId,'google-user-123');
console.log('  ✓ Session created with Google ID');

console.log('\n[Test 14] Session without Google ID (legacy)');
const legacyToken=sessionManager.createSession(legacyAccount.account_id,null);
const legacySession=sessionManager.validateSessionFull(legacyToken);
assert.strictEqual(legacySession.accountId,legacyAccount.account_id);
assert.strictEqual(legacySession.googleId,null);
console.log('  ✓ Legacy session created without Google ID');

console.log('\n[Test 15] Cleanup and verify production DB untouched');
sessionManager.destroy();
closeDb();
resetDb();
if(fs.existsSync(TEST_DB_PATH)){fs.unlinkSync(TEST_DB_PATH)}
const prodDb=path.join(__dirname,'..','data','pool.db');
assert(fs.existsSync(prodDb),'production DB exists');
console.log('  ✓ Test DB cleaned up');

console.log('\n✅ ALL GOOGLE AUTH TESTS PASSED\n');
}

runTests().catch(err=>{
console.error('\n❌ TEST FAILED:',err.message);
console.error(err.stack);
try{closeDb();resetDb()}catch(e){}
if(fs.existsSync(TEST_DB_PATH)){fs.unlinkSync(TEST_DB_PATH)}
process.exit(1);
});
