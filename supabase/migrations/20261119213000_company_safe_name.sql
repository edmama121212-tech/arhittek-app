-- The journal routes unassigned movements to this unique, permanent wallet.
update arhittek_finance.wallets
set name = 'Сейф'
where is_default is true
  and name is distinct from 'Сейф';
