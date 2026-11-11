ALTER FUNCTION public.search_catalog(text, text, text, text, boolean, integer, integer, text, boolean, text[], text, integer, numeric, numeric) SECURITY DEFINER;
ALTER FUNCTION public.search_catalog(text, text, text, text, boolean, integer, integer, text, boolean, text[], text, integer, numeric, numeric) SET search_path = public;
GRANT EXECUTE ON FUNCTION public.new_arrivals(integer, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.log_search_miss(text) TO anon;