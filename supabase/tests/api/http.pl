use strict;
use warnings;
use IO::Socket::INET;
use JSON::PP;

# Tiny HTTP/1.1 client (the image has no curl): reads JSON lines {id,method,path,token,body,headers} from the plan file,
# sends each to rest:3000 over the internal Docker network and prints one JSON line {id,status,body} per request.
my ($plan, $host, $port) = @ARGV;
$host ||= 'rest';
$port ||= 3000;
my $json = JSON::PP->new->canonical;
open(my $fh, '<', $plan) or die "plan: $!";
while (my $line = <$fh>) {
    next unless $line =~ /\S/;
    my $r = $json->decode($line);
    my $body = defined $r->{body} ? $r->{body} : '';
    my $sock = IO::Socket::INET->new(PeerAddr => $host, PeerPort => $port, Proto => 'tcp', Timeout => 20) or do {
        print $json->encode({ id => $r->{id}, status => 0, body => "connect: $!" }), "\n";
        next;
    };
    my $req = "$r->{method} $r->{path} HTTP/1.1\r\nHost: $host:$port\r\nConnection: close\r\nAccept: application/json\r\n";
    $req .= "Authorization: Bearer $r->{token}\r\n" if $r->{token};
    $req .= "Content-Type: application/json\r\n" if length $body;
    $req .= "Content-Length: " . length($body) . "\r\n" if length $body || $r->{method} ne 'GET';
    for my $k (sort keys %{ $r->{headers} || {} }) { $req .= "$k: $r->{headers}{$k}\r\n"; }
    $req .= "\r\n$body";
    print $sock $req;
    local $/;
    my $resp = <$sock>;
    close $sock;
    my ($head, $rest) = split(/\r\n\r\n/, $resp // '', 2);
    my ($status) = ($head // '') =~ m{^HTTP/\S+\s+(\d+)};
    $rest //= '';
    if (($head // '') =~ /transfer-encoding:\s*chunked/i) {
        my $out = '';
        while ($rest =~ /\G([0-9a-fA-F]+)[^\r\n]*\r\n/gc) {
            my $len = hex($1);
            last if $len == 0;
            $out .= substr($rest, pos($rest), $len);
            pos($rest) += $len + 2;
        }
        $rest = $out;
    }
    print $json->encode({ id => $r->{id}, status => $status + 0, body => $rest }), "\n";
}
